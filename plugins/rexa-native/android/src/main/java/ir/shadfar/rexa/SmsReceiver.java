package ir.shadfar.rexa;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Telephony;
import android.telephony.SmsMessage;

public class SmsReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
        Bundle extras = intent.getExtras();
        if (extras == null) return;
        Object[] pdus = (Object[]) extras.get("pdus");
        if (pdus == null) return;
        String format = extras.getString("format");
        for (Object pdu : pdus) {
            try {
                SmsMessage sms = SmsMessage.createFromPdu((byte[]) pdu, format);
                if (sms != null) {
                    RexaNativePlugin.onSmsReceived(
                        context,
                        sms.getDisplayOriginatingAddress(),
                        sms.getDisplayMessageBody(),
                        sms.getTimestampMillis()
                    );
                }
            } catch (Exception ignored) {}
        }
    }
}
