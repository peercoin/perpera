
import { Buffer } from 'buffer';
import { Address } from './blockchain';

export type Hash = 'sha2-256' | 'sha2-512' | 'sha3-256' | 'sha3-512';

export interface State {
  readonly time: Date;
  readonly owner: string;
  readonly hash: {readonly [h in Hash]?: Buffer};
}

export interface Transition {
  readonly state: State;
  readonly txids: string[];
  readonly nextOwner?: string;
  readonly uris?: string[];
}

