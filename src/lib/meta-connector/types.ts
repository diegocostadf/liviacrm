/** Domain types shared between Meta Connector SDK and UI. */
export type GraphError = {
  message?: string;
  code?: number;
  error_subcode?: number;
  type?: string;
  fbtrace_id?: string;
};

export type EmbeddedSignupPayload = {
  /** Short-lived code from FB.login response. */
  code: string;
  /** Optional payload from `message` postMessage (waba_id, phone_number_id, business_id). */
  signupInfo?: {
    waba_id?: string;
    phone_number_id?: string;
    business_id?: string;
  };
};

export type ConnectionOverview = {
  connected: boolean;
  business?: {
    id: string;
    metaBusinessId: string;
    businessName: string;
    portfolioId: string | null;
    connectedAt: string;
  };
  waba?: {
    id: string;
    wabaId: string;
    name: string | null;
    subscribed: boolean;
  };
  phone?: {
    id: string;
    phoneNumberId: string;
    displayPhoneNumber: string;
    verifiedName: string | null;
    qualityRating: string | null;
    messagingLimit: string | null;
  };
  token?: {
    kind: "business" | "system_user";
    expiresAt: string | null;
    lastRefreshedAt: string;
    scopes: string[] | null;
    /** Never returns the token value itself. */
    hasToken: true;
  };
  webhook?: {
    status: string;
    callbackUrl: string;
    lastEventAt: string | null;
  };
};