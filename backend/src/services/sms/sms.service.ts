import "dotenv/config";

import type {
    SmsProvider,
    SmsOtpPayload,
    SmsSendResult,
} from "./sms.types.js";

import { ConsoleSmsProvider } from "./providers/console-sms.provider.js";

function createSmsProvider(): SmsProvider {
    const providerName = process.env.SMS_PROVIDER ?? "console";

    switch (providerName) {
        case "console":
            if (process.env.NODE_ENV === "production") {
                throw new Error(
                    "Console SMS provider cannot be used in production."
                );
            }

            return new ConsoleSmsProvider();

        default:
            throw new Error(
                `Unsupported SMS provider: ${providerName}`
            );
    }
}

const smsProvider = createSmsProvider();

export async function sendOtpSms(
    payload: SmsOtpPayload
): Promise<SmsSendResult> {
    return smsProvider.sendOtp(payload);
}