import type {
    SmsProvider,
    SmsOtpPayload,
    SmsSendResult,
} from "../sms.types.js";

export class ConsoleSmsProvider implements SmsProvider {

    async sendOtp(
        payload: SmsOtpPayload
    ): Promise<SmsSendResult> {

        console.log("--------------------------------");
        console.log("SMS OTP (Development Mode)");
        console.log("Phone:", payload.phone);
        console.log("Purpose:", payload.purpose);
        console.log("OTP:", payload.code);
        console.log("--------------------------------");

        return {
            messageId: `console-${Date.now()}`,
        };
    }
}