import { OtpPurpose } from "../../../generated/prisma/client.js";

export interface SmsOtpPayload {
    phone: string;
    code: string;
    purpose: OtpPurpose;
}

export interface SmsSendResult {
    messageId?: string;
}

export interface SmsProvider {
    sendOtp(
        payload: SmsOtpPayload
    ): Promise<SmsSendResult>;
}