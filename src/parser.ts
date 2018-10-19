
import { Buffer } from 'buffer';
import { encode as encodeBase58 } from 'bs58';

import { Address, HashFn, Network, Transaction } from './blockchain';
import { Hash, Hashes, State, Transition } from './model';
import { TxPayload } from './protobuf';

type Mut<T> = {
  -readonly [P in keyof T]: T[P];
};

export class Parser {
  constructor(
    public readonly tagHash: Buffer,
    public readonly network: Network
  ) {}

  private time: Date|null = null;
  private owner: Buffer|null = null;
  private ownerAddress: string|null = null;
  private hash: Hashes = {};
  private uris: string[] = [];

  private spender: Buffer|null = null;
  private nextOwner: Buffer|null = null;
  private contentUpdate: boolean = false;
  private dhash: Hashes = {};
  private dhashSize: number = 0;
  private duris: string[] = [];

  private txids: string[] = [];
  private transitions: Transition[] = [];

  private reset() {
    this.spender = null;
    this.nextOwner = null;
    this.contentUpdate = false;
    this.dhash = {};
    this.dhashSize = 0;
    this.duris = [];
  }

  private addHash(h: Hash, d: Buffer): boolean {
    let v;
    if (this.contentUpdate) {
      v = this.hash[h];
      if (v) return v.equals(d);
    }
    v = this.dhash[h];
    if (v) return v.equals(d);
    this.dhash[h] = d;
    this.dhashSize++;
    return true;
  }

  private push() {
    const hash: Hashes = {};
    for (const h in this.hash) hash[h] = this.hash[h];

    if (!this.ownerAddress) {
      this.ownerAddress = this.network.pkhAddress(this.owner!);
    }

    const t: Mut<Transition> = {
      state: {
        time: this.time!,
        owner: this.ownerAddress!,
        hash: hash
      },
      txids: this.txids
    };

    if (this.uris.length !== 0) {
      t.uris = this.uris;
      this.uris = [];
    }

    this.time = null;
    this.txids = [];

    if (this.nextOwner) {
      const nextAddress = this.network.pkhAddress(this.nextOwner);
      t.nextOwner = nextAddress;
      this.owner = this.nextOwner;
      this.ownerAddress = nextAddress;
    }

    this.transitions.push(t);
  }

  private flush() {
    if (this.time) this.push();
  }

  private commit(txid: string, time: Date) {
    if (this.contentUpdate) {
      this.flush();
    }
    this.txids.push(txid);
    if (!this.owner) this.owner = this.spender;
    if (this.contentUpdate) {
      this.time = time;
      this.hash = {};
    }
    for (const h in this.dhash) this.hash[h] = this.dhash[h];
    for (const uri of this.duris) this.uris.push(uri);
    if (this.nextOwner) {
      this.push();
    }
    this.reset();
  }

  private feed_inner(tx: Transaction): boolean {
    const scriptSig = tx.inputs[0].script;
    if (!scriptSig.isPublicKeyHashIn()) return false;

    const pubkey: Buffer = (scriptSig as any).chunks[1].buf;
    const spender = HashFn.sha256ripemd160(pubkey);
    if (this.owner && !spender.equals(this.owner)) return false;
    this.spender = spender;

    const scriptTagHash = tx.outputs[0].script;
    if (!scriptTagHash.isPublicKeyHashOut()) return false;

    const tagHash: Buffer = (scriptTagHash as any).chunks[2].buf;
    if (!tagHash.equals(this.tagHash)) return false;

    const scriptPayload = tx.outputs[1].script;
    if (!scriptPayload.isDataOut()) return false;

    let payload: TxPayload;
    try {
      payload = TxPayload.decode(scriptPayload.getData());
    } catch (e) {
      return false;
    }

    const extraFlags = ~(TxPayload.Flags.CONTENT_UPDATE | TxPayload.Flags.OWNERSHIP_TRANSFER);
    if ((payload.flags & extraFlags) !== 0) return false;

    const contentUpdate = (payload.flags & TxPayload.Flags.CONTENT_UPDATE) !== 0;
    if (!this.owner && !contentUpdate) return false;
    this.contentUpdate = contentUpdate;

    const ownershipTransfer = (payload.flags & TxPayload.Flags.OWNERSHIP_TRANSFER) !== 0;
    if (ownershipTransfer) {
      if (tx.inputs.length < 2) return false;
      const scriptPubkey = tx.inputs[1].script;
      if (!scriptPubkey.isPublicKeyHashIn()) return false;
      const pubkey: Buffer = (scriptPubkey as any).chunks[1].buf;
      this.nextOwner = HashFn.sha256ripemd160(pubkey);
    }

    if (payload.sha2) {
      for (const sha2 of payload.sha2) {
        const buf = Buffer.from(sha2);
        const ok = ((buf.length === 32) && this.addHash('sha2-256', buf)) ||
          ((buf.length === 64) && this.addHash('sha2-512', buf));
        if (!ok) return false;
      }
    }

    if (payload.sha3) {
      for (const sha3 of payload.sha3) {
        const buf = Buffer.from(sha3);
        const ok = ((buf.length === 32) && this.addHash('sha3-256', buf)) ||
          ((buf.length === 64) && this.addHash('sha3-512', buf));
        if (!ok) return false;
      }
    }

    if (contentUpdate && this.dhashSize === 0) return false;

    for (const uri of payload.uri) {
      this.duris.push(uri);
    }

    for (const http of payload.http) {
      this.duris.push(`http://${http}`);
    }

    for (const https of payload.https) {
      this.duris.push(`http://${https}`);
    }

    for (const ipfs of payload.ipfs) {
      const base58 = encodeBase58(ipfs);
      this.duris.push(`ipfs://${base58}`);
    }

    for (const msha1 of payload.magnetSha1) {
      const hex = Buffer.from(msha1).toString('hex');
      this.duris.push(`magnet:?xt=urn:sha1:${hex}`);
    }

    for (const mbtih of payload.magnetBtih) {
      const hex = Buffer.from(mbtih).toString('hex');
      this.duris.push(`magnet:?xt=urn:btih:${hex}`);
    }

    return true;
  }

  feed(txid: string, tx: Transaction, time: Date): boolean {
    if (this.feed_inner(tx)) {
      this.commit(txid, time);
      return true;
    } else {
      this.reset();
      return false;
    }
  }

  finish(): Transition[] {
    this.flush();
    this.time = null;
    this.owner = null;
    this.ownerAddress = null;
    this.hash = {};
    this.uris = [];
    const ts = this.transitions;
    this.transitions = [];
    return ts;
  }
}

