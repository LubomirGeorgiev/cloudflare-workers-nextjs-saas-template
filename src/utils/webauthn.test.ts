import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { afterEach, expect, test, vi } from "vitest";

const {
  generateAuthenticationOptionsMock,
  generateRegistrationOptionsMock,
  getDBMock,
  verifyAuthenticationResponseMock,
} = vi.hoisted(() => ({
  generateAuthenticationOptionsMock: vi.fn(async (options: Record<string, unknown>) => ({
    challenge: "challenge-1",
    ...options,
  })),
  generateRegistrationOptionsMock: vi.fn(async (options: Record<string, unknown>) => ({
    challenge: "challenge-1",
    ...options,
  })),
  getDBMock: vi.fn(),
  verifyAuthenticationResponseMock: vi.fn(async () => ({
    verified: true,
    authenticationInfo: {
      newCounter: 2,
    },
  })),
}));

vi.mock("server-only", () => ({}));

vi.mock("@simplewebauthn/server", () => ({
  generateAuthenticationOptions: generateAuthenticationOptionsMock,
  generateRegistrationOptions: generateRegistrationOptionsMock,
  verifyAuthenticationResponse: verifyAuthenticationResponseMock,
  verifyRegistrationResponse: vi.fn(),
}));

vi.mock("@/db", () => ({
  getDB: getDBMock,
}));

const webauthn = await import("@/utils/webauthn");

afterEach(() => {
  vi.clearAllMocks();
});

test("requests discoverable credentials when registering passkeys", async () => {
  mockCredentialLookup([]);

  await webauthn.generatePasskeyRegistrationOptions("user-1", "user@example.com");

  expect(generateRegistrationOptionsMock).toHaveBeenCalledWith(expect.objectContaining({
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
  }));
});

test("generates browser-selectable authentication options without an email lookup", async () => {
  const options = await webauthn.generateDiscoverablePasskeyAuthenticationOptions();

  expect(getDBMock).not.toHaveBeenCalled();
  expect(generateAuthenticationOptionsMock).toHaveBeenCalledWith({
    rpID: "localhost",
    userVerification: "required",
    allowCredentials: [],
  });
  expect(options).toMatchObject({
    challenge: "challenge-1",
    allowCredentials: [],
  });
});

test("verifies authentication from the browser-selected credential", async () => {
  const { findFirstMock, response, updateSetMock } = mockAuthenticationLookup();

  const result = await webauthn.verifyPasskeyAuthentication({
    response,
    challenge: "challenge-1",
  });

  expect(findFirstMock).toHaveBeenCalledWith({
    where: { credentialId: "credential-1" },
  });
  expect(verifyAuthenticationResponseMock).toHaveBeenCalledWith(expect.objectContaining({
    response,
    expectedChallenge: "challenge-1",
    requireUserVerification: true,
  }));
  expect(updateSetMock).toHaveBeenCalledWith({ counter: 2 });
  expect(result.credential.userId).toBe("user-1");
});

function mockCredentialLookup(credentials: unknown[]) {
  getDBMock.mockReturnValue({
    query: {
      passKeyCredentialTable: {
        findMany: vi.fn(async () => credentials),
      },
    },
  });
}

function mockAuthenticationLookup() {
  const findFirstMock = vi.fn(async () => ({
    credentialId: "credential-1",
    credentialPublicKey: "cHVibGljLWtleQ",
    counter: 1,
    transports: JSON.stringify(["internal"]),
    userId: "user-1",
  }));
  const updateWhereMock = vi.fn(async () => undefined);
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));
  const response = {
    id: "credential-1",
    rawId: "credential-1",
    response: {
      clientDataJSON: "client-data",
      authenticatorData: "authenticator-data",
      signature: "signature",
    },
    type: "public-key",
    clientExtensionResults: {},
  } satisfies AuthenticationResponseJSON;

  getDBMock.mockReturnValue({
    query: {
      passKeyCredentialTable: {
        findFirst: findFirstMock,
      },
    },
    update: updateMock,
  });

  return { findFirstMock, response, updateSetMock };
}
