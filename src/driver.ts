
import { Address, Network, UnspentOutput } from './blockchain';
import { Buffer } from 'buffer';

export type RawOrHex = Buffer|string;

export type TxId = RawOrHex;

export interface TxData {
  raw: RawOrHex;
  blockhash: RawOrHex;
}

export interface BlockData {
  height: number;
  time: Date;
  txids: TxId[];
}

export abstract class Driver {
  readonly network: Network;

  abstract taggedTransactions(tag: Address): AsyncIterable<TxId>;

  abstract getTransaction(txid: TxId): Promise<TxData>;

  abstract sendRawTransaction(tx: Buffer): Promise<TxId>;

  abstract getBlock(hash: Buffer): Promise<BlockData>;

  abstract unspentOutputs(address: Address): Promise<UnspentOutput[]>;
}

export interface Builder {
  (network: Network): Driver | null;
}

let builders: Builder[] = [];

export function add(builder: Builder): void {
  builders.push(builder);
}

export function match(network: Network): Driver | null {
  for (let builder of builders) {
    const driver = builder(network);
    if (driver)
      return driver;
  }
  return null;
}

