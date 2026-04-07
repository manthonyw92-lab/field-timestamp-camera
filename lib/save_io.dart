import 'dart:io';
import 'dart:typed_data';
import 'package:gal/gal.dart';
import 'package:path_provider/path_provider.dart';

/// Mobile / Desktop: saves JPEG to DCIM gallery + JSON sidecar to documents.
Future<void> savePhoto(
    Uint8List jpgBytes, String metaJson, String filename) async {
  // Save JPEG into the device gallery (DCIM on Android)
  await Gal.putImageBytes(jpgBytes, name: filename);

  // Save JSON sidecar alongside in the app documents directory
  final dir = await getApplicationDocumentsDirectory();
  await File('${dir.path}/$filename.json').writeAsString(metaJson);
}
