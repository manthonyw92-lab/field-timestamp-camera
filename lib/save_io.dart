import 'dart:io';
import 'dart:typed_data';
import 'package:gal/gal.dart';
import 'package:native_exif/native_exif.dart';
import 'package:path_provider/path_provider.dart';

/// Mobile: embeds EXIF metadata, saves JPEG to DCIM/FieldCamera gallery,
/// and writes a JSON sidecar to the app documents directory.
Future<void> savePhoto(
    Uint8List jpgBytes,
    String metaJson,
    String filename,
    Map<String, String> exifAttrs) async {
  // Write JPEG to a temp file so native_exif can work on it
  final tmp = await getTemporaryDirectory();
  final tmpFile = File('${tmp.path}/ftc_exif_tmp.jpg');
  await tmpFile.writeAsBytes(jpgBytes);

  // Embed EXIF (GPS, timestamps, description) using native Android ExifInterface
  final exif = await Exif.fromPath(tmpFile.path);
  await exif.writeAttributes(exifAttrs);
  await exif.close();

  // Read the EXIF-enriched bytes back, save to gallery
  final enrichedBytes = await tmpFile.readAsBytes();
  await Gal.putImageBytes(enrichedBytes, album: 'FieldCamera');

  // JSON sidecar in app documents (for programmatic auditing)
  final dir = await getApplicationDocumentsDirectory();
  await File('${dir.path}/$filename.json').writeAsString(metaJson);

  // Clean up temp file
  await tmpFile.delete();
}
