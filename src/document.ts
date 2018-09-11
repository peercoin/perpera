
import { Buffer } from 'buffer';
import * as bitcore from 'bitcore-lib';

import { Address, Network, Transaction } from './blockchain';
import { RawOrHex, Driver, match as matchDriver } from './driver';
import { Parser } from './parser';
import { TxPayload } from './protobuf';
import { Hash, State, Transition } from './model';

interface Tx {
  raw: Buffer;
  blockhash: string;
}

interface Block {
  time: Date,
  hash: Buffer;
  height: number;
  txids: string[];
}

export class Document {
  public readonly tagHash: Buffer;
  public readonly address: Address;
  public readonly driver: Driver;

  public transitions: Transition[] = [];

  constructor(public readonly tag: string, public readonly network: Network) {
    this.tagHash = bitcore.crypto.Hash.sha256ripemd160(Buffer.from(tag));
    this.address = new Address(this.tagHash, network.data, 'pubkeyhash');

    let driver = matchDriver(network);
    if (!driver)
      throw new Error(`No driver for ${network.coin}, network "${network.data.name}".`);
    this.driver = driver;

    this.txs = new Map<string, Tx>();
    this.blocks = new Map<string, Block>();
  }

  private txs: Map<string, Tx>;

  private getTx(txid: string): Tx {
    const t = this.txs.get(txid);
    if (t) return t;
    else throw new Error(`missing transaction ${txid}`);
  }

  private async loadTxs(): Promise<string[]> {
    const txids: string[] = [];
    const wait: Promise<void>[] = [];

    for await (const txid of this.driver.taggedTransactions(this.address)) {
      const hex = rawToHex(txid);
      txids.push(hex);
      if (this.txs.has(hex)) continue;
      wait.push(this.driver.getTransaction(txid).then(tx => {
        if (this.txs.has(hex)) return;
        this.txs.set(hex, {
          raw: hexToRaw(tx.raw),
          blockhash: rawToHex(tx.blockhash)
        });
      }));
    }

    await Promise.all(wait);
    return txids;
  }

  private blocks: Map<string, Block>;

  private getBlock(hash: string): Block {
    const b = this.blocks.get(hash);
    if (b) return b;
    else throw new Error(`missing block ${hash}`);
  }

  private async loadBlocks(): Promise<Block[]> {
    const s = new Set<string>(); // blockhash
    const m = new Map<string, string[]>(); // blockhash -> txid[]

    for (const txid of await this.loadTxs()) {
      const tx = this.txs.get(txid);
      if (!tx) throw new Error();
      const { blockhash } = tx;
      s.add(blockhash);
      if (this.blocks.get(blockhash)) continue;
      const l = m.get(blockhash);
      if (l) l.push(txid);
      else m.set(blockhash, [txid]);
    }

    const wait: Promise<void>[] = [];

    for (const [blockhash, txids] of m) {
      const hash = Buffer.from(blockhash, 'hex');

      wait.push(this.driver.getBlock(hash).then(data => {
        const block: Block = {
          hash: hash,
          height: data.height,
          time: data.time,
          txids: []
        };

        for (const txid of data.txids) {
          const hex = rawToHex(txid);
          if (txids.includes(hex)) {
            block.txids.push(hex);
          }
        }

        this.blocks.set(blockhash, block);
      }));
    }

    await Promise.all(wait);

    const blocks: Block[] = [];
    for (const blockhash of s) {
      blocks.push(this.getBlock(blockhash));
    }
    blocks.sort((b1, b2) => b1.height - b2.height);
    return blocks;
  }

  private async performLoad(): Promise<void> {
    const parser = new Parser(this.tagHash, this.network);

    const blocks = await this.loadBlocks();
    for (const block of blocks) {
      for (const txid of block.txids) {
        const tx = this.driver.network.transaction(this.getTx(txid).raw);
        if (!parser.feed(txid, tx, block.time)) {
          console.log(`transaction rejected: ${txid}`);
        }
      }
    }

    this.transitions = parser.finish();
  }

  private loadInProgress = false;
  private loadQueue: {resolve: () => void, reject: (any) => void}[] = [];

  async load(): Promise<void> {
    if (this.loadInProgress) {
      return new Promise<void>((resolve, reject) => {
        this.loadQueue.push({resolve: resolve, reject: reject});
      });
    }

    this.loadInProgress = true;
    return this.performLoad().then(() => {
      this.loadInProgress = false;
      for (let { resolve } of this.loadQueue) {
        resolve();
      }
      this.loadQueue = [];
    }, (reason) => {
      this.loadInProgress = false;
      for (let { reject } of this.loadQueue) {
        reject(reason);
      }
      this.loadQueue = [];
    });
  }

  currentOwner(): string|null {
    const ts = this.transitions;
    if (ts.length == 0) return null;
    const last = ts[ts.length - 1];
    return last.nextOwner || last.state.owner;
  }
}

function rawToHex(x: RawOrHex): string {
  return typeof x === 'string'? x : x.toString('hex');
}

function hexToRaw(x: RawOrHex): Buffer {
  return typeof x === 'string'? Buffer.from(x, 'hex') : x;
}

