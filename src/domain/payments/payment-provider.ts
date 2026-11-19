import type { PaymentMethod } from "../bills/types";
export type PaymentRequest = {
  idempotencyKey: string;
  amountCents: number;
  fail: boolean;
};
export type PaymentResult = {
  externalId: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
};
export interface PaymentProvider {
  submit(request: PaymentRequest): Promise<PaymentResult>;
  getStatus(externalId: string): Promise<PaymentResult["status"]>;
}
class MockProvider implements PaymentProvider {
  constructor(private method: string) {}
  async submit(request: PaymentRequest): Promise<PaymentResult> {
    return {
      externalId: `SIM-${this.method}-${request.fail ? "FAIL" : "OK"}-${request.idempotencyKey}`,
      status: "PENDING",
    };
  }
  async getStatus(externalId: string) {
    return externalId.includes("-FAIL-")
      ? ("FAILED" as const)
      : ("COMPLETED" as const);
  }
}
export class MockACHProvider extends MockProvider {
  constructor() {
    super("ACH");
  }
}
export class MockCreditCardProvider extends MockProvider {
  constructor() {
    super("CARD");
  }
}
export class MockCheckProvider extends MockProvider {
  constructor() {
    super("CHECK");
  }
}
export class MockPortalProvider extends MockProvider {
  constructor() {
    super("PORTAL");
  }
}
export function providerFor(method: PaymentMethod): PaymentProvider {
  return {
    ACH: new MockACHProvider(),
    CREDIT_CARD: new MockCreditCardProvider(),
    CHECK: new MockCheckProvider(),
    PORTAL: new MockPortalProvider(),
  }[method];
}
