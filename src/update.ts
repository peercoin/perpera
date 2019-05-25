
import { Buffer } from 'buffer';
import { encode as encodeBase58 } from 'bs58';

import { Address, Network, Transaction } from './blockchain';
import { Hash, Hashes, State, Transition } from './model';
import { ITxPayload, TxPayload } from './protobuf';

interface HashField {
  bytes: number;
  push: (payload: ITxPayload, hash: Buffer) => void;
}

function pushSha2(payload: ITxPayload, hash: Buffer) {
  if ('sha2' in payload === false) payload.sha2 = [];
  payload.sha2!.push(hash);
}

function pushSha3(payload: ITxPayload, hash: Buffer) {
  if ('sha3' in payload === false) payload.sha3 = [];
  payload.sha3!.push(hash);
}

const hashFields: {[h in Hash]: HashField} = {
  'sha2-256': { bytes: 32, push: pushSha2 },
  'sha2-512': { bytes: 64, push: pushSha2 },
  'sha3-256': { bytes: 32, push: pushSha3 },
  'sha3-512': { bytes: 64, push: pushSha3 }
};

// maxPayLoad for Peercoin v0.7 is 256 bytes
const maxPayloadSize: number = 256;

export function contentUpdate(hash: Hashes): TxPayload[] {
  const payloads: TxPayload[] = [];

  let payload: ITxPayload = {
    flags: TxPayload.Flags.CONTENT_UPDATE
  };
  let bytes: number = 1;

  const go = (h: Hash) => {
    if (h in hash === false) return;
    const f = hashFields[h];
    const b = hash[h]!;
    if (b.length !== f.bytes)
      throw new Error(`invalid hash length for ${h}`);
    if (bytes + 2 + f.bytes > maxPayloadSize) {
      payloads.push(TxPayload.create(payload));
      payload = {};
      bytes = 0;
    }
    f.push(payload, b);
    bytes += 2 + f.bytes;
  };

  const hashOrder: Hash[] = ['sha2-512', 'sha3-512', 'sha2-256', 'sha3-256'];
  for (const h of hashOrder) go(h);

  payloads.push(TxPayload.create(payload));
  return payloads;
}

export function uriAdd(uri: string): TxPayload {
  const payload: ITxPayload = {};

  if (uri.startsWith('http://')) {
    payload.http = [uri.substring(7)];
  } else if (uri.startsWith('https://')) {
    payload.https = [uri.substring(8)];
  } else {
    payload.uri = [uri];
  }

  return TxPayload.create(payload);
}

