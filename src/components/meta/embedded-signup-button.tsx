import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

type SignupInfo = { waba_id?: string; phone_number_id?: string; business_id?: string };

type Props = {
  appId: string;
  configId: string;
  graphVersion?: string;
  onComplete: (payload: { code: string; signupInfo?: SignupInfo }) => Promise<void> | void;
  disabled?: boolean;
};

/**
 * Meta Embedded Signup button.
 * - Loads the FB JS SDK once.
 * - Listens to postMessage events from the WhatsApp signup iframe to capture
 *   { waba_id, phone_number_id, business_id }.
 * - Calls FB.login with the Solution `config_id` and forwards the resulting
 *   short-lived `code` plus the captured signup info to the server.
 */
export function EmbeddedSignupButton({
  appId,
  configId,
  graphVersion = "v21.0",
  onComplete,
  disabled,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const signupInfoRef = useRef<SignupInfo | undefined>(undefined);

  // Listen for the WhatsApp signup window's postMessage (waba_id/phone_number_id).
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.type === "WA_EMBEDDED_SIGNUP" && data?.event === "FINISH" && data?.data) {
          signupInfoRef.current = {
            waba_id: data.data.waba_id,
            phone_number_id: data.data.phone_number_id,
            business_id: data.data.business_id,
          };
        }
      } catch {
        /* ignore non-JSON payloads */
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Load FB SDK once.
  useEffect(() => {
    if (!appId) return;
    if (window.FB) {
      setSdkReady(true);
      return;
    }
    window.fbAsyncInit = () => {
      window.FB?.init({ appId, cookie: true, xfbml: false, version: graphVersion });
      setSdkReady(true);
    };
    const existing = document.getElementById("facebook-jssdk");
    if (existing) {
      setSdkReady(true);
      return;
    }
    const s = document.createElement("script");
    s.id = "facebook-jssdk";
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    document.body.appendChild(s);
  }, [appId, graphVersion]);

  async function handleClick() {
    if (!window.FB) {
      toast.error("SDK do Facebook não carregado ainda. Tente novamente.");
      return;
    }
    if (!configId) {
      toast.error("META_LOGIN_CONFIG_ID não configurado.");
      return;
    }
    setLoading(true);
    signupInfoRef.current = undefined;
    window.FB.login(
      async (response: any) => {
        try {
          const code = response?.authResponse?.code;
          if (!code) {
            const status = response?.status ?? "cancelled";
            toast.error(`Login cancelado ou falhou (${status}).`);
            return;
          }
          await onComplete({ code, signupInfo: signupInfoRef.current });
        } finally {
          setLoading(false);
        }
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
      },
    );
  }

  return (
    <Button onClick={handleClick} disabled={disabled || loading || !sdkReady} size="lg">
      {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
      Conectar WhatsApp com Meta
    </Button>
  );
}