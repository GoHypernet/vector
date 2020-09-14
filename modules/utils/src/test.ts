import {
  FullChannelState,
  ChannelUpdate,
  UpdateType,
  CreateUpdateDetails,
  DepositUpdateDetails,
  ResolveUpdateDetails,
  SetupUpdateDetails,
  LinkedTransferState,
  ChannelUpdateDetailsMap,
  CoreTransferState,
  LinkedTransferStateEncoding,
  LinkedTransferResolverEncoding,
  UpdateParams,
  UpdateParamsMap,
} from "@connext/vector-types";

import { Balance, TransferState } from "../../types/dist/src";

import { ChannelSigner } from "./channelSigner";

export const mkAddress = (prefix = "0x0"): string => {
  return prefix.padEnd(42, "0");
};

export const mkPublicIdentifier = (prefix = "indraA"): string => {
  return prefix.padEnd(55, "0");
};

export const mkHash = (prefix = "0x"): string => {
  return prefix.padEnd(66, "0");
};

export const mkBytes32 = (prefix = "0xa"): string => {
  return prefix.padEnd(66, "0");
};

// Helper partial types for test helpers
type PartialChannelUpdate<T extends UpdateType> = Partial<
  Omit<ChannelUpdate<T>, "details"> & { details: Partial<ChannelUpdateDetailsMap[T]> }
>;

type PartialFullChannelState<T extends UpdateType> = Partial<
  Omit<FullChannelState, "latestUpdate"> & { latestUpdate: PartialChannelUpdate<T> }
>;

type PartialTransferOverrides = Partial<{ balance: Partial<Balance>; assetId: string }>;

type PartialUpdateParams<T extends UpdateType> = Partial<
  Omit<UpdateParams<T>, "details"> & { details?: Partial<UpdateParamsMap[T]> }
>;

export function createTestUpdateParams<T extends UpdateType>(
  type: T,
  overrides: PartialUpdateParams<T>,
): UpdateParams<T> {
  const base = {
    channelAddress: mkAddress("0xccc"),
    type,
  };

  let details: any;
  switch (type) {
    case UpdateType.setup:
      details = {
        counterpartyIdentifier: mkPublicIdentifier("0xbbb"),
        timeout: "1200",
        networkContext: {
          channelFactoryAddress: mkAddress("0xcha"),
          vectorChannelMastercopyAddress: mkAddress("0xcccaaa"),
          adjudicatorAddress: mkAddress("0xaaaddd"),
        },
      };
      break;
    case UpdateType.deposit:
      details = {
        channelAddress: base.channelAddress,
        amount: "10",
        assetId: mkAddress(),
      };
      break;
    case UpdateType.create:
      details = {
        channelAddress: mkAddress("0xccc"),
        amount: "15",
        assetId: mkAddress("0x0"),
        transferDefinition: mkAddress("0xdef"),
        transferInitialState: createTestLinkedTransferState(),
        timeout: "1",
        encodings: ["state", "resolver"],
        meta: { test: "meta" },
      };
      break;
    case UpdateType.resolve:
      details = {
        channelAddress: mkAddress("0xccc"),
        transferId: mkBytes32("0xabcdef"),
        transferResolver: { preImage: mkBytes32("0xcdef") },
        meta: { test: "meta" },
      };
      break;
  }

  const { details: detailOverrides, ...defaultOverrides } = overrides;

  return {
    ...base,
    details: {
      ...details,
      ...(detailOverrides ?? {}),
    },
    ...defaultOverrides,
  };
}

export function createTestChannelUpdate<T extends UpdateType>(
  type: T,
  overrides: PartialChannelUpdate<T> = {},
): ChannelUpdate<T> {
  // Generate the base update values
  const baseUpdate = {
    assetId: mkAddress("0x0"),
    balance: {
      amount: ["1", "0"],
      to: [mkAddress("0xaaa"), mkAddress("0xbbb")],
    },
    channelAddress: mkAddress("0xccc"),
    fromIdentifier: mkPublicIdentifier("indraA"),
    nonce: 1,
    signatures: [mkBytes32("0xsig1"), mkBytes32("0xsig2")],
    toIdentifier: mkPublicIdentifier("indraB"),
    type,
  };

  // Get details from overrides
  const { details: detailOverrides, ...defaultOverrides } = overrides;

  // Assign detail defaults based on update
  let details: CreateUpdateDetails | DepositUpdateDetails | ResolveUpdateDetails | SetupUpdateDetails;
  switch (type) {
    case UpdateType.setup:
      details = {
        networkContext: {
          adjudicatorAddress: mkAddress("0xaaaddd"),
          chainId: 1337,
          channelFactoryAddress: mkAddress("0xcha"),
          providerUrl: "http://localhost:8545",
          vectorChannelMastercopyAddress: mkAddress("0xmast"),
        },
        timeout: "1",
      } as SetupUpdateDetails;
      break;
    case UpdateType.deposit:
      details = {
        latestDepositNonce: 1,
      } as DepositUpdateDetails;
      break;
    case UpdateType.create:
      details = {
        merkleProofData: mkBytes32("0xproof"),
        merkleRoot: mkBytes32("0xroot"),
        transferDefinition: mkAddress("0xdef"),
        transferEncodings: ["create", "resolve"],
        transferId: mkBytes32("0xid"),
        transferInitialState: {
          balance: {
            amount: ["10", "0"],
            to: [mkAddress("0xaaa"), mkAddress("0xbbb")],
          },
          linkedHash: mkBytes32("0xlinkedhash"),
        } as LinkedTransferState,
        transferTimeout: "0",
      } as CreateUpdateDetails;
      break;
    case UpdateType.resolve:
      details = {
        merkleRoot: mkBytes32("0xroot1"),
        transferDefinition: mkAddress("0xdef"),
        transferEncodings: ["create", "resolve"],
        transferId: mkBytes32("id"),
        transferResolver: { preImage: mkBytes32("0xpre") },
      } as ResolveUpdateDetails;
      break;
  }
  return {
    ...baseUpdate,
    details: {
      ...details,
      ...(detailOverrides ?? {}),
    },
    ...(defaultOverrides ?? {}),
  } as ChannelUpdate<T>;
}

export function createTestChannelState<T extends UpdateType = typeof UpdateType.setup>(
  type: T,
  overrides: PartialFullChannelState<T> = {},
): FullChannelState<T> {
  // Get some default values that should be consistent between
  // the channel state and the channel update
  const publicIdentifiers = overrides.publicIdentifiers ?? [mkPublicIdentifier("indraA"), mkPublicIdentifier("indraB")];
  const participants = overrides.participants ?? [mkAddress("0xaaa"), mkAddress("0xbbb")];
  const channelAddress = mkAddress("0xccc");
  const assetIds = overrides.assetIds ?? [mkAddress("0x0"), mkAddress("0x1")];
  const nonce = overrides.nonce ?? 1;
  return {
    assetIds,
    balances: [
      // assetId0
      {
        amount: ["1", "2"],
        to: [...participants],
      },
      // assetId1
      {
        amount: ["1", "2"],
        to: [...participants],
      },
    ],
    lockedValue: [
      {
        amount: "1",
      },
      {
        amount: "2",
      },
    ],
    channelAddress,
    latestDepositNonce: 1,
    // TODO: wtf typescript? why do i have to any cast this
    latestUpdate: createTestChannelUpdate(type, {
      channelAddress,
      fromIdentifier: publicIdentifiers[0],
      toIdentifier: publicIdentifiers[1],
      assetId: assetIds[0],
      nonce,
      ...(overrides.latestUpdate ?? {}),
    }) as any,
    merkleRoot: mkHash(),
    networkContext: {
      adjudicatorAddress: mkAddress("0xaaaddd"),
      chainId: 1337,
      channelFactoryAddress: mkAddress("0xcha"),
      providerUrl: "http://localhost:8545",
      vectorChannelMastercopyAddress: mkAddress("0xmast"),
    },
    nonce,
    participants,
    publicIdentifiers,
    timeout: "1",
    ...overrides,
  };
}

export function createTestChannelStateWithSigners<T extends UpdateType = typeof UpdateType.setup>(
  signers: ChannelSigner[],
  type: T,
  overrides: PartialFullChannelState<T> = {},
): FullChannelState<T> {
  const publicIdentifiers = signers.map((s) => s.publicIdentifier);
  const participants = signers.map((s) => s.address);
  const signerOverrides = {
    publicIdentifiers,
    participants,
    ...(overrides ?? {}),
  };
  return createTestChannelState(type, signerOverrides) as FullChannelState<T>;
}

export function createTestChannelUpdateWithSigners<T extends UpdateType = typeof UpdateType.setup>(
  signers: ChannelSigner[],
  type: T,
  overrides: PartialChannelUpdate<T> = {},
): ChannelUpdate<T> {
  // The only update type where signers could matter
  // is when providing the transfer initial state to the
  // function
  const details: any = {};
  if (type === UpdateType.create) {
    details.transferInitialState = createTestLinkedTransferState({
      balance: {
        to: signers.map((s) => s.address),
      },
      ...(((overrides as unknown) as ChannelUpdate<"create">).details.transferInitialState ?? {}),
    });
  }

  const signerOverrides = {
    balance: {
      to: signers.map((s) => s.address),
      amount: ["1", "0"],
    },
    fromIdentifier: signers[0].publicIdentifier,
    toIdentifier: signers[1].publicIdentifier,
    ...(overrides ?? {}),
  };

  return createTestChannelUpdate(type, signerOverrides);
}

export const createTestLinkedTransferState = (
  overrides: PartialTransferOverrides & { linkedHash?: string } = {},
): LinkedTransferState => {
  const { balance: balanceOverrides, ...defaultOverrides } = overrides;
  return {
    balance: {
      to: [mkAddress("0xaaa"), mkAddress("0xbbb")],
      amount: ["1", "0"],
      ...(balanceOverrides ?? {}),
    },
    linkedHash: mkHash("0xeee"),
    ...defaultOverrides,
  };
};

export const createTestLinkedTransferStates = (
  count = 2,
  overrides: PartialTransferOverrides[] = [],
): TransferState[] => {
  return Array(count)
    .fill(0)
    .map((val, idx) => {
      return createTestLinkedTransferState({ ...(overrides[idx] ?? {}) });
    });
};

export function createCoreTransferState(overrides: Partial<CoreTransferState> = {}): CoreTransferState {
  // TODO: make dependent on transfer def/name
  return {
    initialBalance: { to: [mkAddress("0xaa"), mkAddress("0xbbb")], amount: ["1", "0"] },
    assetId: mkAddress(),
    channelAddress: mkAddress("0xccc"),
    transferId: mkBytes32("0xeeefff"),
    transferDefinition: mkAddress("0xdef"),
    transferEncodings: [LinkedTransferStateEncoding, LinkedTransferResolverEncoding],
    initialStateHash: mkBytes32("0xabcdef"),
    transferTimeout: "1",
    ...overrides,
  };
}