# Keep all Flutter engine classes (prevents ClassNotFoundException at runtime)
-keep class io.flutter.** { *; }
-keep class io.flutter.util.** { *; }
-keep class io.flutter.plugin.** { *; }
-keep class io.flutter.embedding.** { *; }

# Keep path_provider and related plugins
-keep class androidx.core.content.** { *; }

# Keep geolocator / location services
-keep class com.baseflow.geolocator.** { *; }

# Keep camera plugin
-keep class io.flutter.plugins.camera.** { *; }

# Keep permission handler
-keep class com.baseflow.permissionhandler.** { *; }

# Prevent R8 from removing classes accessed via reflection
-keepattributes *Annotation*
-keepattributes Signature
