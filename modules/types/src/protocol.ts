import {
  ChannelUpdate,
  CreateTransferParams,
  DepositParams,
  FullTransferState,
  ResolveTransferParams,
  SetupParams,
  UpdateType,
  FullChannelState,
  RestoreParams,
} from "./channel";
import { ProtocolError, Result } from "./error";
import { ProtocolEventName, ProtocolEventPayloadsMap } from "./event";

export interface IVectorProtocol {
  signerAddress: string;
  publicIdentifier: string;
  setup(params: SetupParams): Promise<Result<FullChannelState, ProtocolError>>;
  deposit(params: DepositParams): Promise<Result<FullChannelState, ProtocolError>>;
  create(params: CreateTransferParams): Promise<Result<FullChannelState, ProtocolError>>;
  resolve(params: ResolveTransferParams): Promise<Result<FullChannelState, ProtocolError>>;

  on<T extends ProtocolEventName>(
    event: T,
    callback: (payload: ProtocolEventPayloadsMap[T]) => void | Promise<void>,
    filter?: (payload: ProtocolEventPayloadsMap[T]) => boolean,
  ): void;
  once<T extends ProtocolEventName>(
    event: T,
    callback: (payload: ProtocolEventPayloadsMap[T]) => void | Promise<void>,
    filter?: (payload: ProtocolEventPayloadsMap[T]) => boolean,
  ): void;
  off<T extends ProtocolEventName>(event?: T): Promise<void>;
  waitFor<T extends ProtocolEventName>(
    event: T,
    timeout: number,
    filter?: (payload: ProtocolEventPayloadsMap[T]) => boolean,
  ): Promise<ProtocolEventPayloadsMap[T]>;

  getChannelState(channelAddress: string): Promise<FullChannelState | undefined>;
  getChannelStateByParticipants(alice: string, bob: string, chainId: number): Promise<FullChannelState | undefined>;
  getChannelStates(): Promise<FullChannelState[]>;
  getTransferState(transferId: string): Promise<FullTransferState | undefined>;
  getActiveTransfers(channelAddress: string): Promise<FullTransferState[]>;
  syncDisputes(): Promise<void>;
  restoreState(params: RestoreParams): Promise<Result<FullChannelState, ProtocolError>>;
}

type VectorChannelMessageData<T extends UpdateType = any> = {
  update: ChannelUpdate<T>;
  latestUpdate: ChannelUpdate<any> | undefined;
};

export type VectorChannelMessage<T extends UpdateType = any> = {
  to: string;
  from: string;
  inbox: string;
  data: VectorChannelMessageData<T>;
};

export type VectorErrorMessage = Omit<VectorChannelMessage, "data"> & {
  error: ProtocolError; // returned by the person receiving an update
};

export type VectorMessage = VectorChannelMessage | VectorErrorMessage;
