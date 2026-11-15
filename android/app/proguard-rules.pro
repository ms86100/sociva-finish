# Sociva Capacitor + Firebase release shrinking rules.
# Keep reflection-based Capacitor plugins and FCM/Crashlytics entry points.

-keepattributes SourceFile,LineNumberTable,*Annotation*,Signature,InnerClasses,EnclosingMethod
-renamesourcefileattribute SourceFile

# App package: FCM service, Cap plugins, channels, ringer
-keep class app.sociva.community.** { *; }

# Capacitor bridge and plugins (reflection / annotations)
-keep class com.getcapacitor.** { *; }
-keep class org.apache.cordova.** { *; }
-keep public class * extends com.getcapacitor.Plugin
-keepclassmembers class * {
    @com.getcapacitor.annotation.CapacitorPlugin *;
    @com.getcapacitor.PluginMethod *;
    @com.getcapacitor.NativePlugin *;
}
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Official Capacitor Android plugins
-keep class com.capacitorjs.plugins.** { *; }

# Third-party Capacitor plugins used by Sociva
-keep class com.getcapacitor.community.fcm.** { *; }
-keep class dev.barooni.capacitor.calendar.** { *; }
-keep class nl.raphael.settings.** { *; }
-keep class com.capacitor.rateApp.** { *; }

# Firebase Messaging + Crashlytics
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# Kotlin metadata used by some AndroidX / plugin libs
-dontwarn kotlin.**
-keep class kotlin.Metadata { *; }
