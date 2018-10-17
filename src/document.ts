
import { Buffer } from 'buffer';
import * as bitcore from 'bitcore-lib';

import { Address, Network, Transaction, UnspentOutput } from './blockchain';
import { RawOrHex, Driver, match as matchDriver } from './driver';
import { Parser } from './parser';
import { TxPayload } from './protobuf';
import { Hash, Hashes, State, Transition } from './model';
import { Spender } from './spender';
import { contentUpdate, uriAdd } from './update';

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

export type HexHashes = {[h in Hash]?: Buffer|string};

function normalizeHashes(hash: HexHashes): Hashes {
  const result: Hashes = {};
  for (const h in hash) {
    const v = hash[h];
    result[h] = v instanceof Buffer? v : Buffer.from(v, 'hex');
  }
  return result;
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

  private async performSync(): Promise<void> {
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

  private syncInProgress = false;
  private syncQueue: {resolve: () => void, reject: (any) => void}[] = [];

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

  currentOwner(): string|null {
    const ts = this.transitions;
    if (ts.length === 0) return null;
    const last = ts[ts.length - 1];
    return last.nextOwner || last.state.owner;
  }

  async updateContent(hash: HexHashes, spender: Spender): Promise<void> {
    const owner = this.currentOwner();
    if (owner && owner !== spender.address.toString())
      throw new Error('The given spender is not the current owner.');

    const payloads = contentUpdate(normalizeHashes(hash));

    const txs: Transaction[] = [];
    for (const payload of payloads) {
      const tx = this.network.transaction();
      tx.feePerKb(this.network.feePerKb);

      const utxos = spender.allocate(this.network.p2thFee + this.network.minOutput);
      if (utxos === null) throw new Error('Insufficient funds.');
      tx.from(utxos!);

      this.network.runThunk(() => {
        const data = Buffer.from(TxPayload.encode(payload).finish());
        tx.to(this.address, this.network.p2thFee)
          .addData(data)
          .change(spender.address)
          .sign(spender.privateKey);
      });

      const change = tx.getChangeOutput()!;

      const rawTx = (tx as any).toBuffer();
      const txId = await this.driver.sendRawTransaction(rawTx);

      spender.push(new UnspentOutput({
        txId: txId instanceof Buffer? txId.toString('hex') : txId,
        outputIndex: 2,
        scriptPubKey: change.script,
        satoshis: change.satoshis,
        address: spender.address
      }));
    }
  }

  async addUri(uri: string, spender: Spender): Promise<void> {
    const owner = this.currentOwner();
    if (!owner)
      throw new Error('URIs may only be added after the initial content.');
    else if (owner !== spender.address.toString())
      throw new Error('The given spender is not the current owner.');

    const tx = this.network.transaction();
    tx.feePerKb(this.network.feePerKb);

    const utxos = spender.allocate(this.network.p2thFee + this.network.minOutput);
    if (utxos === null) throw new Error('Insufficient funds.');
    tx.from(utxos!);

    const data = Buffer.from(TxPayload.encode(uriAdd(uri)).finish());
    if (data.length >= 80)
      throw new Error('URI too long for OP_RETURN payload.');

    this.network.runThunk(() => {
      tx.to(this.address, this.network.p2thFee)
        .addData(data)
        .change(spender.address)
        .sign(spender.privateKey);
    });

    const change = tx.getChangeOutput()!;

    const rawTx = (tx as any).toBuffer();
    const txId = await this.driver.sendRawTransaction(rawTx);

    spender.push(new UnspentOutput({
      txId: txId instanceof Buffer? txId.toString('hex') : txId,
      outputIndex: 2,
      scriptPubKey: change.script,
      satoshis: change.satoshis,
      address: spender.address
    }));
  }
}

function rawToHex(x: RawOrHex): string {
  return typeof x === 'string'? x : x.toString('hex');
}

function hexToRaw(x: RawOrHex): Buffer {
  return typeof x === 'string'? Buffer.from(x, 'hex') : x;
}

