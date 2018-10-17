
import { Buffer } from 'buffer';

import { Address, Coin, Network, UnspentOutput } from '../blockchain';
import * as driver from '../driver';

export class Driver implements driver.Driver {
  private readonly url: string;

  constructor(public readonly network: Network, prefix?: string) {
    this.url = `https://${prefix||''}explorer.peercoin.net`;
  }

  private async fetch(href: string): Promise<Response> {
    const response = await fetch(`${this.url}/${href}`);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return response;
  }

  private fetchJson(href: string): Promise<any> {
    return this.fetch(href).then((response) => response.json());
  }

  private fetchString(href: string): Promise<string> {
    return this.fetch(href).then((response) => response.text());
  }

  async *taggedTransactions(tag: Address): AsyncIterable<driver.TxId> {
    const data = await this.fetchJson(`ext/getaddress/${tag.toString()}`);
    if (typeof data === 'object' && data.last_txs instanceof Array) {
      for (let tx of data.last_txs) {
        if (typeof tx !== 'object' ||
          tx.type !== 'vout' ||
          typeof tx.addresses !== 'string') continue;
        yield tx.addresses;
      }
    }
  }

  async getTransaction(txid: Buffer): Promise<driver.TxData> {
    const hex = txid.toString('hex');
    const data = await this.fetchJson(`api/getrawtransaction?txid=${hex}&decrypt=1`);
    return {
      raw: data.hex,
      blockhash: data.blockhash
    };
  }

  async sendRawTransaction(tx: Buffer): Promise<string> {
    const hex = tx.toString('hex');
    const data = await this.fetchString(`api/sendrawtransaction?hex=${hex}`);
    return data;
  }

  async getBlock(hash: Buffer): Promise<driver.BlockData> {
    const hex = hash.toString('hex');
    const data = await this.fetchJson(`api/getblock?hash=${hex}`);
    return {
      height: data.height,
      time: new Date(data.time * 1000),
      txids: data.tx
    };
  }

  async unspentOutputs(address: Address): Promise<UnspentOutput[]> {
    const utxos: UnspentOutput[] = [];
    const data = await this.fetchJson(`ext/listunspent/${address.toString()}`);
    for (const utxo of data.unspent_outputs) {
      utxos.push(new UnspentOutput({
        txid: utxo.tx_hash,
        vout: utxo.tx_ouput_n,
        address: address,
        script: utxo.script,
        satoshis: Math.floor(utxo.value / 100)
      }));
    }
    utxos.reverse();
    return utxos;
  }
}

driver.add((network: Network): Driver|null => {
  if (network.coin === Coin.Ppc) {
    if (network.testnet)
      return new Driver(network, 'testnet-');
    else
      return new Driver(network);
  }
  return null;
})

