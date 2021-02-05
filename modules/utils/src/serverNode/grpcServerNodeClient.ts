import {
  INodeClient,
  NodeParams,
  NodeResponses,
  OptionalPublicIdentifier,
  Result,
  EngineEvent,
  EngineEventMap,
  GrpcTypes,
  jsonifyError,
  FullTransferState,
  FullChannelState,
  ChannelUpdateDetailsMap,
  ChannelUpdate,
} from "@connext/vector-types";
import { ChannelCredentials } from "@grpc/grpc-js";
import { UnaryCall } from "@protobuf-ts/runtime-rpc";
import { GrpcTransport } from "@protobuf-ts/grpc-transport";
import { BaseLogger } from "pino";
import { Evt } from "evt";

import { ServerNodeServiceError } from "./errors";

const convertTransfer = (transfer: GrpcTypes.FullTransferState): FullTransferState => {
  return {
    ...transfer,
    transferState: GrpcTypes.Struct.toJson(transfer.transferState),
    transferResolver: transfer.transferResolver ? GrpcTypes.Struct.toJson(transfer.transferResolver) : undefined,
    meta: transfer.meta ? GrpcTypes.Struct.toJson(transfer.meta) : undefined,
    balance: transfer.balance ?? { amount: [], to: [] },
  };
};

const convertChannel = <T extends "setup" | "create" | "resolve" | "deposit">(
  channel: GrpcTypes.FullChannelState,
): FullChannelState<T> => {
  let updateDetails: ChannelUpdateDetailsMap[T];
  if (channel.latestUpdate && channel.latestUpdate.type === "setup") {
    const typedDetails: any = channel.latestUpdate.details;
    updateDetails = {
      ...typedDetails.setupUpdateDetails,
      meta: typedDetails.setupUpdateDetails.meta
        ? GrpcTypes.Struct.toJson(typedDetails.setupUpdateDetails.meta)
        : undefined,
    };
  } else if (channel.latestUpdate && channel.latestUpdate.type === "create") {
    const typedDetails: any = channel.latestUpdate.details;
    updateDetails = {
      ...typedDetails.createUpdateDetails,
      transferInitialState: GrpcTypes.Struct.toJson(typedDetails.createUpdateDetails.transferInitialState),
      meta: typedDetails.createUpdateDetails.meta
        ? GrpcTypes.Struct.toJson(typedDetails.createUpdateDetails.meta)
        : undefined,
    };
  } else if (channel.latestUpdate && channel.latestUpdate.type === "resolve") {
    const typedDetails: any = channel.latestUpdate.details;
    updateDetails = {
      ...typedDetails.resolveUpdateDetails,
      transferResolver: GrpcTypes.Struct.toJson(typedDetails.resolveUpdateDetails.transferResolver),
      meta: typedDetails.resolveUpdateDetails.meta
        ? GrpcTypes.Struct.toJson(typedDetails.resolveUpdateDetails.meta)
        : undefined,
    };
  } else if (channel.latestUpdate && channel.latestUpdate.type === "deposit") {
    const typedDetails: any = channel.latestUpdate.details;
    updateDetails = {
      ...typedDetails.depositUpdateDetails,
      meta: typedDetails.depositUpdateDetails.meta
        ? GrpcTypes.Struct.toJson(typedDetails.depositUpdateDetails.meta)
        : undefined,
    };
  }

  const latestUpdate = {
    ...channel.latestUpdate,
    details: updateDetails,
  } as ChannelUpdate<T>;

  return {
    ...channel,
    latestUpdate,
  } as any;
};

export class GRPCServerNodeClient implements INodeClient {
  public publicIdentifier = "";
  public signerAddress = "";
  public client: GrpcTypes.ServerNodeServiceClient;
  public evts: { [eventName in EngineEvent]: Evt<EngineEventMap[eventName]> };

  private constructor(private readonly serverNodeUrl: string, private readonly logger: BaseLogger) {
    const transport = new GrpcTransport({
      host: this.serverNodeUrl,
      channelCredentials: ChannelCredentials.createInsecure(),
    });
    this.client = new GrpcTypes.ServerNodeServiceClient(transport);
    this.evts = {
      CONDITIONAL_TRANSFER_CREATED: new Evt(),
      CONDITIONAL_TRANSFER_RESOLVED: new Evt(),
      DEPOSIT_RECONCILED: new Evt(),
      IS_ALIVE: new Evt(),
      REQUEST_COLLATERAL: new Evt(),
      RESTORE_STATE_EVENT: new Evt(),
      SETUP: new Evt(),
      WITHDRAWAL_CREATED: new Evt(),
      WITHDRAWAL_RESOLVED: new Evt(),
      WITHDRAWAL_RECONCILED: new Evt(),
    };
  }

  static async connect(
    serverNodeUrl: string,
    logger: BaseLogger,
    index?: number,
    skipCheckIn?: boolean,
  ): Promise<GRPCServerNodeClient> {
    const service = new GRPCServerNodeClient(serverNodeUrl, logger);
    // If an index is provided, the service will only host a single engine
    // and the publicIdentifier will be automatically included in parameters
    if (index) {
      // Create the public identifier and signer address
      const node = await service.createNode({ index, skipCheckIn });
      if (node.isError) {
        logger.error({ error: node.getError()!.message, method: "connect" }, "Failed to create node");
        throw node.getError();
      }
      const { publicIdentifier, signerAddress } = node.getValue();
      service.publicIdentifier = publicIdentifier;
      service.signerAddress = signerAddress;
    }

    // each event stream needs to be consumed by the client and posted into EVTs to preserve the API
    (async () => {
      for await (const data of service.client.conditionalTransferCreatedStream({}).response) {
        const transfer = convertTransfer(data.transfer);
        service.evts.CONDITIONAL_TRANSFER_CREATED.post({
          ...data,
          transfer,
          channelBalance: data.channelBalance ?? { amount: [], to: [] },
        });
      }
    })();

    (async () => {
      for await (const data of service.client.conditionalTransferResolvedStream({}).response) {
        const transfer = convertTransfer(data.transfer);
        service.evts.CONDITIONAL_TRANSFER_RESOLVED.post({
          ...data,
          transfer,
          channelBalance: data.channelBalance ?? { amount: [], to: [] },
        });
      }
    })();

    (async () => {
      for await (const data of service.client.depositReconciledStream({}).response) {
        service.evts.DEPOSIT_RECONCILED.post({
          ...data,
          meta: data.meta ? GrpcTypes.Struct.toJson(data.meta) : undefined,
          channelBalance: data.channelBalance ?? { amount: [], to: [] },
        });
      }
    })();

    (async () => {
      for await (const data of service.client.depositReconciledStream({}).response) {
        service.evts.DEPOSIT_RECONCILED.post({
          ...data,
          meta: data.meta ? GrpcTypes.Struct.toJson(data.meta) : undefined,
          channelBalance: data.channelBalance ?? { amount: [], to: [] },
        });
      }
    })();

    (async () => {
      for await (const data of service.client.isAliveStream({}).response) {
        service.evts.IS_ALIVE.post(data);
      }
    })();

    (async () => {
      for await (const data of service.client.requestCollateralStream({}).response) {
        service.evts.REQUEST_COLLATERAL.post({
          ...data,
          meta: data.meta ? GrpcTypes.Struct.toJson(data.meta) : undefined,
        });
      }
    })();

    (async () => {
      for await (const data of service.client.restoreStateStream({}).response) {
        service.evts.RESTORE_STATE_EVENT.post({
          ...data,
          meta: data.meta ? GrpcTypes.Struct.toJson(data.meta) : undefined,
        });
      }
    })();

    (async () => {
      for await (const data of service.client.setupStream({}).response) {
        service.evts.SETUP.post({
          ...data,
          meta: data.meta ? GrpcTypes.Struct.toJson(data.meta) : undefined,
        });
      }
    })();

    (async () => {
      for await (const data of service.client.withdrawalCreatedStream({}).response) {
        const transfer = convertTransfer(data.transfer);
        service.evts.WITHDRAWAL_CREATED.post({
          ...data,
          transfer,
          meta: data.meta ? GrpcTypes.Struct.toJson(data.meta) : undefined,
          channelBalance: data.channelBalance ?? { amount: [], to: [] },
        });
      }
    })();

    (async () => {
      for await (const data of service.client.withdrawalResolvedStream({}).response) {
        const transfer = {
          ...data.transfer,
          transferState: GrpcTypes.Struct.toJson(data.transfer.transferState),
          transferResolver: data.transfer.transferResolver
            ? GrpcTypes.Struct.toJson(data.transfer.transferResolver)
            : undefined,
          meta: data.transfer.meta ? GrpcTypes.Struct.toJson(data.transfer.meta) : undefined,
          balance: data.transfer.balance ?? { amount: [], to: [] },
        };
        service.evts.WITHDRAWAL_RESOLVED.post({
          ...data,
          transfer,
          meta: data.meta ? GrpcTypes.Struct.toJson(data.meta) : undefined,
          channelBalance: data.channelBalance ?? { amount: [], to: [] },
        });
      }
    })();

    (async () => {
      for await (const data of service.client.withdrawalReconciledStream({}).response) {
        service.evts.WITHDRAWAL_RECONCILED.post({
          ...data,
          meta: data.meta ? GrpcTypes.Struct.toJson(data.meta) : undefined,
        });
      }
    })();

    return service;
  }

  async getPing(): Promise<Result<string, ServerNodeServiceError>> {
    try {
      const res = await this.validateAndExecuteGrpcRequest<GrpcTypes.Empty, GrpcTypes.GenericMessageResponse>(
        "getPing",
        {},
      );
      return Result.ok(res.message);
    } catch (e) {
      return Result.fail(e);
    }
  }

  async getStatus(publicIdentifier?: string): Promise<Result<NodeResponses.GetStatus, ServerNodeServiceError>> {
    try {
      const res = await this.validateAndExecuteGrpcRequest<
        OptionalPublicIdentifier<GrpcTypes.GenericPublicIdentifierRequest>,
        GrpcTypes.Status
      >("getStatus", {
        publicIdentifier,
      });
      return Result.ok(res);
    } catch (e) {
      return Result.fail(e);
    }
  }

  async getRouterConfig(
    params: OptionalPublicIdentifier<NodeParams.GetRouterConfig>,
  ): Promise<Result<NodeResponses.GetRouterConfig, ServerNodeServiceError>> {
    try {
      const res = await this.validateAndExecuteGrpcRequest<
        OptionalPublicIdentifier<GrpcTypes.GetRouterConfigRequest>,
        GrpcTypes.RouterConfig
      >("getRouterConfig", params);
      return Result.ok(res as any);
    } catch (e) {
      return Result.fail(e);
    }
  }

  async getConfig(): Promise<Result<NodeResponses.GetConfig, ServerNodeServiceError>> {
    try {
      const res = await this.validateAndExecuteGrpcRequest<GrpcTypes.Empty, GrpcTypes.Configs>("getConfig", undefined);
      return Result.ok(res.config);
    } catch (e) {
      return Result.fail(e);
    }
  }

  async getTransfer(
    params: OptionalPublicIdentifier<NodeParams.GetTransferState>,
  ): Promise<Result<NodeResponses.GetTransferState, ServerNodeServiceError>> {
    try {
      const res = await this.validateAndExecuteGrpcRequest<
        OptionalPublicIdentifier<GrpcTypes.TransferRequest>,
        GrpcTypes.FullTransferState | undefined
      >("getTransferState", params);
      const transfer = res ? convertTransfer(res) : undefined;
      return Result.ok(transfer);
    } catch (e) {
      return Result.fail(e);
    }
  }

  async getActiveTransfers(
    params: OptionalPublicIdentifier<NodeParams.GetActiveTransfersByChannelAddress>,
  ): Promise<Result<NodeResponses.GetActiveTransfersByChannelAddress, ServerNodeServiceError>> {
    try {
      const res = await this.validateAndExecuteGrpcRequest<
        OptionalPublicIdentifier<GrpcTypes.ActiveTransfersRequest>,
        GrpcTypes.FullTransferStates
      >("getActiveTransfers", params);

      const transfers = res.fullTransferStates.map(convertTransfer);
      return Result.ok(transfers);
    } catch (e) {
      return Result.fail(e);
    }
  }

  async getTransferByRoutingId(
    params: OptionalPublicIdentifier<NodeParams.GetTransferStateByRoutingId>,
  ): Promise<Result<NodeResponses.GetTransferStateByRoutingId, ServerNodeServiceError>> {
    try {
      const res = await this.validateAndExecuteGrpcRequest<
        OptionalPublicIdentifier<GrpcTypes.TransferStateByRoutingIdRequest>,
        GrpcTypes.FullTransferState | undefined
      >("getTransferState", params);
      const transfer = res ? convertTransfer(res) : undefined;
      return Result.ok(transfer);
    } catch (e) {
      return Result.fail(e);
    }
  }

  async getTransfersByRoutingId(
    params: OptionalPublicIdentifier<NodeParams.GetTransferStatesByRoutingId>,
  ): Promise<Result<NodeResponses.GetTransferStatesByRoutingId, ServerNodeServiceError>> {
    try {
      const res = await this.validateAndExecuteGrpcRequest<
        OptionalPublicIdentifier<GrpcTypes.TransferStatesByRoutingIdRequest>,
        GrpcTypes.FullTransferStates
      >("getTransferStatesByRoutingId", params);

      const transfers = res.fullTransferStates.map(convertTransfer);
      return Result.ok(transfers);
    } catch (e) {
      return Result.fail(e);
    }
  }

  async getStateChannel(
    params: OptionalPublicIdentifier<NodeParams.GetChannelState>,
  ): Promise<Result<NodeResponses.GetChannelState, ServerNodeServiceError>> {
    try {
      const res = await this.validateAndExecuteGrpcRequest<
        OptionalPublicIdentifier<GrpcTypes.ChannelStateRequest>,
        GrpcTypes.FullChannelState | undefined
      >("getChannelState", params);

      const channel = res ? convertChannel(res) : undefined;
      return Result.ok(channel);
    } catch (e) {
      return Result.fail(e);
    }
  }

  async getStateChannelByParticipants(
    params: OptionalPublicIdentifier<NodeParams.GetChannelStateByParticipants>,
  ): Promise<Result<NodeResponses.GetChannelStateByParticipants, ServerNodeServiceError>> {
    try {
      const res = await this.validateAndExecuteGrpcRequest<
        OptionalPublicIdentifier<GrpcTypes.ChannelStateByParticipantsRequest>,
        GrpcTypes.FullChannelState | undefined
      >("getChannelStateByParticipants", params);

      const channel = res ? convertChannel(res) : undefined;
      return Result.ok(channel);
    } catch (e) {
      return Result.fail(e);
    }
  }

  async getStateChannels(
    params: OptionalPublicIdentifier<NodeParams.GetChannelStates>,
  ): Promise<Result<NodeResponses.GetChannelStates, ServerNodeServiceError>> {
    try {
      const res = await this.validateAndExecuteGrpcRequest<
        OptionalPublicIdentifier<GrpcTypes.GenericPublicIdentifierRequest>,
        GrpcTypes.FullChannelStates
      >("getChannelStates", params);

      const channels = res.fullChannelStates.map(convertChannel);
      return Result.ok(channels as any);
    } catch (e) {
      return Result.fail(e);
    }
  }

  async createNode(params: NodeParams.CreateNode): Promise<Result<NodeResponses.CreateNode, ServerNodeServiceError>> {
    try {
      const call = await this.client.createNode(params);
      this.logger.debug({ callStatus: call.status, methodName: "createNode", filled: params }, "gRPC call complete");
      if (call.status.code !== "OK") {
        return Result.fail(
          new ServerNodeServiceError(
            ServerNodeServiceError.reasons.InternalServerError,
            this.publicIdentifier,
            "createNode",
            params,
            {
              call,
            },
          ),
        );
      }
      return Result.ok(call.response);
    } catch (e) {
      this.logger.error({ error: jsonifyError(e), methodName: "createNode", params }, "Error occurred");
      return Result.fail(
        new ServerNodeServiceError(
          ServerNodeServiceError.reasons.InternalServerError,
          this.publicIdentifier,
          "createNode",
          params,
          {
            error: jsonifyError(e),
          },
        ),
      );
    }
  }

  async getRegisteredTransfers(
    params: OptionalPublicIdentifier<NodeParams.GetRegisteredTransfers>,
  ): Promise<Result<NodeResponses.GetRegisteredTransfers, ServerNodeServiceError>> {
    try {
      const res = await this.validateAndExecuteGrpcRequest<
        OptionalPublicIdentifier<GrpcTypes.RegisteredTransfersRequest>,
        GrpcTypes.RegisteredTransfers
      >("getRegisteredTransfers", params);

      res.registeredTransfer;
      return Result.ok(res.registeredTransfer);
    } catch (e) {
      return Result.fail(e);
    }
  }

  async setup(
    params: OptionalPublicIdentifier<NodeParams.RequestSetup>,
  ): Promise<Result<NodeResponses.RequestSetup, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  async internalSetup(
    params: OptionalPublicIdentifier<NodeParams.Setup>,
  ): Promise<Result<NodeResponses.Setup, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  sendDisputeChannelTx(
    params: OptionalPublicIdentifier<NodeParams.SendDisputeChannelTx>,
  ): Promise<Result<NodeResponses.SendDisputeChannelTx, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  sendDefundChannelTx(
    params: OptionalPublicIdentifier<NodeParams.SendDefundChannelTx>,
  ): Promise<Result<NodeResponses.SendDefundChannelTx, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  sendDisputeTransferTx(
    params: OptionalPublicIdentifier<NodeParams.SendDisputeTransferTx>,
  ): Promise<Result<NodeResponses.SendDisputeTransferTx, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  sendDefundTransferTx(
    params: OptionalPublicIdentifier<NodeParams.SendDefundTransferTx>,
  ): Promise<Result<NodeResponses.SendDefundTransferTx, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  restoreState(
    params: OptionalPublicIdentifier<NodeParams.RestoreState>,
  ): Promise<Result<NodeResponses.RestoreState, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  async sendDepositTx(
    params: OptionalPublicIdentifier<NodeParams.SendDepositTx>,
  ): Promise<Result<NodeResponses.SendDepositTx, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  async reconcileDeposit(
    params: OptionalPublicIdentifier<NodeParams.Deposit>,
  ): Promise<Result<NodeResponses.Deposit, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  async requestCollateral(
    params: OptionalPublicIdentifier<NodeParams.RequestCollateral>,
  ): Promise<Result<NodeResponses.RequestCollateral, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  async conditionalTransfer(
    params: OptionalPublicIdentifier<NodeParams.ConditionalTransfer>,
  ): Promise<Result<NodeResponses.ConditionalTransfer, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  async resolveTransfer(
    params: OptionalPublicIdentifier<NodeParams.ResolveTransfer>,
  ): Promise<Result<NodeResponses.ResolveTransfer, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  async withdraw(
    params: OptionalPublicIdentifier<NodeParams.Withdraw>,
  ): Promise<Result<NodeResponses.Withdraw, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  signUtilityMessage(
    params: OptionalPublicIdentifier<NodeParams.SignUtilityMessage>,
  ): Promise<Result<NodeResponses.SignUtilityMessage, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  sendIsAliveMessage(
    params: OptionalPublicIdentifier<NodeParams.SendIsAlive>,
  ): Promise<Result<NodeResponses.SendIsAlive, ServerNodeServiceError>> {
    throw new Error("unimplemented");
  }

  public once<T extends EngineEvent>(
    event: T,
    callback: (payload: EngineEventMap[T]) => void | Promise<void>,
    filter: (payload: EngineEventMap[T]) => boolean = () => true,
    publicIdentifier?: string,
  ): void {
    (this.evts[event].pipe((data) => {
      const mine = [data.aliceIdentifier, data.bobIdentifier].includes(publicIdentifier ?? this.publicIdentifier);
      const allowed = filter(data as any);
      return mine && allowed;
    }) as any).attachOnce(callback);
  }

  public on<T extends EngineEvent>(
    event: T,
    callback: (payload: EngineEventMap[T]) => void | Promise<void>,
    filter: (payload: EngineEventMap[T]) => boolean = () => true,
    publicIdentifier?: string,
  ): void {
    (this.evts[event].pipe((data) => {
      const mine = [data.aliceIdentifier, data.bobIdentifier].includes(publicIdentifier ?? this.publicIdentifier);
      const allowed = filter(data as any);
      return mine && allowed;
    }) as any).attach(callback);
  }

  public waitFor<T extends EngineEvent>(
    event: T,
    timeout: number,
    filter: (payload: EngineEventMap[T]) => boolean = () => true,
    publicIdentifier?: string,
  ): Promise<EngineEventMap[T] | undefined> {
    return (this.evts[event].pipe((data) => {
      const mine = [data.aliceIdentifier, data.bobIdentifier].includes(publicIdentifier ?? this.publicIdentifier);
      const allowed = filter(data as any);
      return mine && allowed;
    }) as any).waitFor(timeout);
  }

  public off<T extends EngineEvent>(event: T, publicIdentifier?: string): void {
    this.evts[event].detach();
  }

  // Helper methods
  // eslint-disable-next-line @typescript-eslint/ban-types
  private async validateAndExecuteGrpcRequest<T extends object, U extends object>(
    methodName: string,
    params: T,
  ): Promise<U> {
    const filled = { publicIdentifier: this.publicIdentifier, ...params };
    console.log("filled: ", filled);

    // Attempt request
    try {
      if (typeof this.client[methodName] !== "function") {
        throw new ServerNodeServiceError(
          ServerNodeServiceError.reasons.InternalServerError,
          filled.publicIdentifier,
          methodName,
          params,
          {
            message: "Method does not exist",
          },
        );
      }
      const call = await (this.client[methodName](filled) as UnaryCall<T, U>);
      this.logger.debug({ callStatus: call.status, methodName, filled }, "gRPC call complete");
      if (call.status.code !== "OK") {
        throw new ServerNodeServiceError(
          ServerNodeServiceError.reasons.InternalServerError,
          filled.publicIdentifier,
          methodName,
          params,
          {
            call,
          },
        );
      }
      return call.response;
    } catch (e) {
      this.logger.error({ error: jsonifyError(e), methodName, params: filled }, "Error occurred");
      throw new ServerNodeServiceError(
        ServerNodeServiceError.reasons.InternalServerError,
        filled.publicIdentifier,
        methodName,
        params,
        {
          error: jsonifyError(e),
        },
      );
    }
  }
}
