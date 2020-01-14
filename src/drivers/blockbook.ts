
import { Buffer } from 'buffer';

import { Address, Coin, Network, UnspentOutput } from '../blockchain';
import * as driver from '../driver';

export class BlockBookDriver implements driver.Driver {
  private readonly url: string;

  constructor(public readonly network: Network, prefix?: string) {
    this.url = `https://${prefix||''}blockbook.peercoin.net`;
  }

  private async fetch(href: string): Promise<Response> {
    const response = await fetch(`${this.url}/${href}`);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return response;
  }

  private fetchJson(href: string): Promise<any> {
    return this.fetch(href).then((response) => response.json());
  }

  async *taggedTransactions(tag: Address): AsyncIterable<driver.TxId> {
    const data = await this.fetchJson(`api/address/${tag.toString()}`);
    if (typeof data === 'object' && data.transactions instanceof Array) {
      for (let txid of data.transactions) {
        yield txid;
      }
    }
  }

  async getTransaction(txid: Buffer): Promise<driver.TxData> {
    const hex = txid.toString('hex');
    const data = await this.fetchJson(`api/tx/${hex}`);

    return {
      raw: data.hex,
      blockhash: data.blockhash
    };
  }
  
  async sendRawTransaction(tx: Buffer): Promise<driver.TxId> {
    const hex = tx.toString('hex');
    const data = await this.fetchJson(`api/sendtx/${hex}`);
    if (typeof data === 'object' && data.result !== undefined) {
      return data.result;
    }

    return data.error;
  }

  async getBlock(hash: Buffer): Promise<driver.BlockData> {
    const hex = hash.toString('hex');
    const data = await this.fetchJson(`api/block/${hex}`);
    const txids: driver.TxId[] = [];
    for (const tx of data.txs) {
      txids.push(tx.txid);
    }
    return {
      height: data.height,
      time: new Date(data.time * 1000),
      txids: txids
    };
  }

  async unspentOutputs(address: Address): Promise<UnspentOutput[]> {
    const data = await this.fetchJson(`api/utxo/${address.toString()}`);
    const utxos: UnspentOutput[] = [];
    for (const utxo of data) {
      const tx = await this.fetchJson(`api/tx/${utxo.txid}`);
      utxos.push(new UnspentOutput({
        txid: utxo.txid,
        vout: utxo.vout,
        address: address,
        script: tx.vout[utxo.vout].scriptPubKey.hex,
        satoshis: Math.floor(utxo.satoshis / 100)
      }));
    }
    return utxos;
  }
}

driver.add((network: Network): BlockBookDriver|null => {
  if (network.coin === Coin.Ppc) {
    if (network.testnet)
      return new BlockBookDriver(network, 't');
    else
      return new BlockBookDriver(network);
  }
  return null;
})


