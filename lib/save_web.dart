// ignore: avoid_web_libraries_in_flutter
import 'dart:html' as html;
import 'dart:typed_data';

/// Web: triggers browser downloads for the JPEG and JSON.
/// EXIF embedding is skipped on web (browser handles its own metadata).
Future<void> savePhoto(
    Uint8List jpgBytes,
    String metaJson,
    String filename,
    Map<String, String> exifAttrs) async {
  _download(jpgBytes, '$filename.jpg', 'image/jpeg');
  _download(
    Uint8List.fromList(metaJson.codeUnits),
    '$filename.json',
    'application/json',
  );
}

void _download(Uint8List bytes, String name, String mimeType) {
  final blob = html.Blob([bytes], mimeType);
  final url = html.Url.createObjectUrlFromBlob(blob);
  final anchor = html.AnchorElement(href: url)
    ..setAttribute('download', name)
    ..click();
  html.Url.revokeObjectUrl(url);
}
