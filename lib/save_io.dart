import 'dart:io';
import 'dart:typed_data';
import 'package:path_provider/path_provider.dart';

/// Mobile / Desktop: saves JPEG + JSON sidecar to the documents directory.
Future<void> savePhoto(
    Uint8List jpgBytes, String metaJson, String filename) async {
  final dir = await getApplicationDocumentsDirectory();
  final jpgPath = '${dir.path}/$filename.jpg';
  final jsonPath = '$jpgPath.json';
  await File(jpgPath).writeAsBytes(jpgBytes);
  await File(jsonPath).writeAsString(metaJson);
}
