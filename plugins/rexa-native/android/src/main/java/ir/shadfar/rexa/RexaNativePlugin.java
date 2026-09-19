package ir.shadfar.rexa;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.provider.Telephony;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.telephony.SmsMessage;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "RexaNative",
    permissions = {
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone"),
        @Permission(strings = { Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS }, alias = "sms")
    }
)
public class RexaNativePlugin extends Plugin {
    private SpeechRecognizer speechRecognizer;
    private static RexaNativePlugin instance;

    @Override
    public void load() {
        instance = this;
        super.load();
    }

    public static void onSmsReceived(Context context, String address, String body, long date) {
        String id = address + ":" + date + ":" + body.hashCode();
        SharedPreferences p = context.getSharedPreferences("rexa_sms", Context.MODE_PRIVATE);
        try {
            JSONArray q = new JSONArray(p.getString("queue", "[]"));
            JSONObject item = new JSONObject();
            item.put("id", id);
            item.put("address", address);
            item.put("body", body);
            item.put("date", date);
            q.put(item);
            while (q.length() > 100) q.remove(0);
            p.edit().putString("queue", q.toString()).apply();
        } catch (Exception ignored) {}

        if (instance != null) {
            instance.emitSms(id, address, body, date);
        }
    }

    private void emitSms(String id, String address, String body, long date) {
        JSObject o = new JSObject();
        o.put("id", id);
        o.put("address", address);
        o.put("body", body);
        o.put("date", date);
        notifyListeners("smsReceived", o, true);
    }

    @PluginMethod
    public void isSpeechAvailable(PluginCall call) {
        boolean available = SpeechRecognizer.isRecognitionAvailable(getContext());
        JSObject o = new JSObject();
        o.put("available", available);
        call.resolve(o);
    }

    @PluginMethod
    public void startSpeech(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
            return;
        }
        startSpeechInternal(call);
    }

    @PluginMethod
    public void stopSpeech(PluginCall call) {
        if (speechRecognizer != null) {
            speechRecognizer.stopListening();
            speechRecognizer.cancel();
            speechRecognizer.destroy();
            speechRecognizer = null;
        }
        call.resolve();
    }

    private void startSpeechInternal(final PluginCall call) {
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("ANDROID_SPEECH_UNAVAILABLE");
            return;
        }
        if (speechRecognizer != null) {
            speechRecognizer.cancel();
            speechRecognizer.destroy();
        }
        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
        final boolean[] finished = {false};
        RecognitionListener listener = new RecognitionListener() {
            private void finish(String error) {
                if (finished[0]) return;
                finished[0] = true;
                if (error == null) {
                    // result is resolved in onResults
                } else {
                    call.reject(error);
                }
            }
            @Override public void onReadyForSpeech(Bundle params) {}
            @Override public void onBeginningOfSpeech() {}
            @Override public void onRmsChanged(float rmsdB) {}
            @Override public void onBufferReceived(byte[] buffer) {}
            @Override public void onEndOfSpeech() {}
            @Override public void onError(int error) { finish("ANDROID_SPEECH_ERROR_" + error); }
            @Override public void onResults(Bundle results) {
                ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                String text = (matches != null && !matches.isEmpty()) ? matches.get(0) : "";
                if (text.trim().isEmpty()) finish("ANDROID_SPEECH_EMPTY");
                else {
                    finished[0] = true;
                    JSObject o = new JSObject();
                    o.put("text", text);
                    call.resolve(o);
                }
                destroySpeech();
            }
            @Override public void onPartialResults(Bundle partialResults) {}
            @Override public void onEvent(int eventType, Bundle params) {}
        };
        speechRecognizer.setRecognitionListener(listener);
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, call.getString("language", "fa-IR"));
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "fa-IR");
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
        speechRecognizer.startListening(intent);
    }

    private void destroySpeech() {
        if (speechRecognizer != null) {
            try { speechRecognizer.destroy(); } catch (Exception ignored) {}
            speechRecognizer = null;
        }
    }

    @PermissionCallback
    public void microphonePermissionCallback(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            startSpeechInternal(call);
        } else {
            call.reject("MICROPHONE_PERMISSION_DENIED");
        }
    }

    @PluginMethod
    public void checkSmsPermissions(PluginCall call) {
        JSObject o = new JSObject();
        o.put("sms", ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED
            ? "granted" : "denied");
        call.resolve(o);
    }

    @PluginMethod
    public void requestSmsPermissions(PluginCall call) {
        requestPermissionForAlias("sms", call, "smsPermissionCallback");
    }

    @PermissionCallback
    public void smsPermissionCallback(PluginCall call) {
        JSObject o = new JSObject();
        boolean granted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED;
        o.put("sms", granted ? "granted" : "denied");
        call.resolve(o);
    }

    @PluginMethod
    public void getRecentSms(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) {
            call.reject("SMS_PERMISSION_DENIED");
            return;
        }
        int limit = call.getInt("limit", 50);
        long since = call.getLong("since", 0L);
        android.database.Cursor cursor = null;
        JSArray arr = new JSArray();
        try {
            cursor = getContext().getContentResolver().query(
                Telephony.Sms.Inbox.CONTENT_URI,
                new String[]{Telephony.Sms._ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE},
                since > 0 ? Telephony.Sms.DATE + " >= ?" : null,
                since > 0 ? new String[]{String.valueOf(since)} : null,
                Telephony.Sms.DATE + " DESC LIMIT " + Math.max(1, Math.min(limit, 200))
            );
            if (cursor != null) {
                int idI = cursor.getColumnIndex(Telephony.Sms._ID);
                int addrI = cursor.getColumnIndex(Telephony.Sms.ADDRESS);
                int bodyI = cursor.getColumnIndex(Telephony.Sms.BODY);
                int dateI = cursor.getColumnIndex(Telephony.Sms.DATE);
                while (cursor.moveToNext()) {
                    JSObject o = new JSObject();
                    o.put("id", cursor.getString(idI));
                    o.put("address", cursor.getString(addrI));
                    o.put("body", cursor.getString(bodyI));
                    o.put("date", cursor.getLong(dateI));
                    arr.put(o);
                }
            }
            JSObject out = new JSObject();
            out.put("messages", arr);
            call.resolve(out);
        } catch (Exception e) {
            call.reject("SMS_READ_FAILED", e.getMessage());
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    @PluginMethod
    public void getPendingSms(PluginCall call) {
        SharedPreferences p = getContext().getSharedPreferences("rexa_sms", Context.MODE_PRIVATE);
        JSArray arr = new JSArray();
        try {
            JSONArray q = new JSONArray(p.getString("queue", "[]"));
            for (int i = 0; i < q.length(); i++) {
                JSONObject item = q.getJSONObject(i);
                JSObject o = new JSObject();
                o.put("id", item.optString("id"));
                o.put("address", item.optString("address"));
                o.put("body", item.optString("body"));
                o.put("date", item.optLong("date"));
                arr.put(o);
            }
            p.edit().remove("queue").apply();
        } catch (Exception ignored) {}
        JSObject out = new JSObject();
        out.put("messages", arr);
        call.resolve(out);
    }

    @Override
    protected void handleOnDestroy() {
        destroySpeech();
        if (instance == this) instance = null;
        super.handleOnDestroy();
    }
}
