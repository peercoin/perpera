
import { PrivateKey } from 'bitcore-lib';
import { Address, Network, UnspentOutput, networks } from './blockchain';
import { Driver, match as matchDriver } from './driver';

export class Spender {
  public readonly address: Address;
  public readonly driver: Driver;

  private txs: Set<string>;
  private unspent: UnspentOutput[];

  constructor(public readonly privateKey: PrivateKey, public readonly network: Network) {
    this.address = (privateKey.toAddress as any)(network.data);
    this.txs = new Set<string>();
    this.unspent = [];

    const driver = matchDriver(network);
    if (!driver)
      throw new Error(`No driver for ${network.coin}, network "${network.data.name}".`);
    this.driver = driver;
  }

  static fromWIF(wif: string, net: Network|string): Spender {
    const network = net instanceof Network? net : networks[net];
    const privateKey = new PrivateKey(wif, network.data);
    return new Spender(privateKey, network);
  }

  private syncInProgress = false;
  private syncQueue: {resolve: () => void, reject: (any) => void}[] = [];

  private async performSync(): Promise<void> {
    const utxos = await this.driver.unspentOutputs(this.address);
    for (const utxo of utxos) this.push(utxo);
  }

  async sync(): Promise<void> {
    if (this.syncInProgress) {
      return new Promise<void>((resolve, reject) => {
        this.syncQueue.push({resolve: resolve, reject: reject});
      });
    }

    this.syncInProgress = true;
    return this.performSync().then(() => {
      this.syncInProgress = false;
      for (const { resolve } of this.syncQueue) resolve();
      this.syncQueue = [];
    }, (reason) => {
      this.syncInProgress = false;
      for (const { reject } of this.syncQueue) reject(reason);
      this.syncQueue = [];
    });
  }

  push(input: UnspentOutput): void {
    if (!this.txs.has(input.txId)) {
      this.txs.add(input.txId);
      this.unspent.push(input);
    }
  }

  allocate(amount: number): UnspentOutput[] | null {
    if (this.unspent.length === 0) return null;

    let count: number = 1;
    let index: number = this.unspent.length - 1;
    let sum: number = this.unspent[index].satoshis;

    while (sum < amount) {
      if (index === 0) return null;
      count += 1;
      index -= 1;
      sum += this.unspent[index].satoshis;
    }

    return this.unspent.splice(index, count);
  }
}

