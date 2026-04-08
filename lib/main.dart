import 'dart:convert';
import 'dart:typed_data';
import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:intl/intl.dart';
import 'package:image/image.dart' as img;

// Conditional imports for platform-specific saving
import 'save_stub.dart'
    if (dart.library.html) 'save_web.dart'
    if (dart.library.io) 'save_io.dart';

late List<CameraDescription> cameras;

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  cameras = await availableCameras();
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Field Timestamp Camera',
      theme: ThemeData.dark().copyWith(
        colorScheme: const ColorScheme.dark(
          primary: Colors.orange,
          secondary: Colors.orangeAccent,
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: Colors.black45,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(6),
            borderSide: BorderSide.none,
          ),
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          isDense: true,
        ),
      ),
      home: const CameraScreen(),
    );
  }
}

// ──────────────────────────────────────────────────────────
// Data model
// ──────────────────────────────────────────────────────────

class PhotoData {
  DateTime capturedTime;
  DateTime displayedTime;
  String gpsAddress;
  String userAddress;
  double lat;
  double lng;
  bool timeModified;
  bool addressModified;
  String jobId;
  String crew;

  PhotoData({
    required this.capturedTime,
    required this.displayedTime,
    required this.gpsAddress,
    required this.userAddress,
    required this.lat,
    required this.lng,
    this.timeModified = false,
    this.addressModified = false,
    this.jobId = '',
    this.crew = '',
  });

  Map<String, dynamic> toJson() => {
        'captured_time': capturedTime.toIso8601String(),
        'displayed_time': displayedTime.toIso8601String(),
        'timestamp_modified': timeModified,
        'gps_lat': lat,
        'gps_lng': lng,
        'gps_address': gpsAddress,
        'user_address': userAddress,
        'address_modified': addressModified,
        'job_id': jobId,
        'crew': crew,
      };
}

// ──────────────────────────────────────────────────────────
// Overlay background style
// ──────────────────────────────────────────────────────────

enum OverlayBg { black, white, none }

// ──────────────────────────────────────────────────────────
// Geocoding via Nominatim (works on all platforms)
// ──────────────────────────────────────────────────────────

Future<String> reverseGeocode(double lat, double lng) async {
  try {
    final uri = Uri.parse(
        'https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=$lat&lon=$lng');
    final response = await http.get(uri,
        headers: {'User-Agent': 'FieldTimestampCamera/1.0'});
    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      final addr = data['address'] as Map<String, dynamic>;
      final parts = [
        addr['house_number'],
        addr['road'],
        addr['city'] ?? addr['town'] ?? addr['village'],
        addr['state'],
      ].whereType<String>().join(', ');
      return parts.isNotEmpty ? parts : data['display_name'] ?? 'Unknown';
    }
  } catch (_) {}
  return '${lat.toStringAsFixed(5)}, ${lng.toStringAsFixed(5)}';
}

// ──────────────────────────────────────────────────────────
// Main camera screen
// ──────────────────────────────────────────────────────────

class CameraScreen extends StatefulWidget {
  const CameraScreen({super.key});

  @override
  State<CameraScreen> createState() => _CameraScreenState();
}

class _CameraScreenState extends State<CameraScreen>
    with WidgetsBindingObserver {
  CameraController? _controller;
  PhotoData? _data;
  bool _ready = false;
  bool _saving = false;
  String? _errorMessage;

  FlashMode _flashMode = FlashMode.auto;

  // Overlay position as fraction [0–1] of the photo dimensions.
  // Default: bottom-left area.
  Offset _overlayAnchor = const Offset(0.02, 0.70);

  // Overlay background style.
  OverlayBg _overlayBg = OverlayBg.black;

  final _addressCtrl = TextEditingController();
  final _jobCtrl = TextEditingController();
  final _crewCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _init();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _controller?.dispose();
    _addressCtrl.dispose();
    _jobCtrl.dispose();
    _crewCtrl.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final ctrl = _controller;
    if (ctrl == null || !ctrl.value.isInitialized) return;
    if (state == AppLifecycleState.inactive) {
      ctrl.dispose();
    } else if (state == AppLifecycleState.resumed) {
      _initCamera();
    }
  }

  Future<void> _init() async {
    try {
      await _initCamera();
      await _initLocation();
      if (mounted) setState(() => _ready = true);
    } catch (e) {
      if (mounted) setState(() => _errorMessage = e.toString());
    }
  }

  Future<void> _initCamera() async {
    if (cameras.isEmpty) throw Exception('No cameras found on this device.');
    final ctrl = CameraController(
      cameras[0],
      ResolutionPreset.high,
      enableAudio: false,
      imageFormatGroup: ImageFormatGroup.jpeg,
    );
    await ctrl.initialize();
    await ctrl.setFlashMode(_flashMode);
    _controller = ctrl;
    if (mounted) setState(() {});
  }

  Future<void> _initLocation() async {
    if (!kIsWeb) {
      final perm = await Geolocator.requestPermission();
      if (perm == LocationPermission.denied ||
          perm == LocationPermission.deniedForever) {
        throw Exception('Location permission denied.');
      }
    }
    final pos = await Geolocator.getCurrentPosition(
      desiredAccuracy: LocationAccuracy.high,
    );
    final address = await reverseGeocode(pos.latitude, pos.longitude);
    final now = DateTime.now();
    _data = PhotoData(
      capturedTime: now,
      displayedTime: now,
      gpsAddress: address,
      userAddress: address,
      lat: pos.latitude,
      lng: pos.longitude,
    );
    _addressCtrl.text = address;
  }

  // ── Photo capture & overlay ──────────────────────────────

  Future<void> _takePhoto() async {
    if (_controller == null || _saving || _data == null) return;
    setState(() => _saving = true);

    try {
      await _controller!.setFlashMode(_flashMode);
      final file = await _controller!.takePicture();
      await _controller!.setFlashMode(FlashMode.off);
      await _controller!.setFlashMode(_flashMode);
      final rawBytes = await file.readAsBytes();

      final decoded = img.decodeImage(rawBytes);
      if (decoded == null) throw Exception('Could not decode image.');
      _drawOverlay(decoded);
      final jpgBytes =
          Uint8List.fromList(img.encodeJpg(decoded, quality: 88));

      final ts = DateFormat('yyyyMMdd_HHmmss').format(DateTime.now());
      final filename = 'field_$ts';
      final metaJson = jsonEncode(_data!.toJson());
      final exifAttrs = _buildExifAttrs();

      await savePhoto(jpgBytes, metaJson, filename, exifAttrs);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(kIsWeb
              ? 'Photo downloaded to your Downloads folder.'
              : 'Photo saved: $filename.jpg'),
          backgroundColor: Colors.green[700],
        ));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text('Error: $e'),
          backgroundColor: Colors.red[700],
        ));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  // ── Overlay rendering ────────────────────────────────────

  /// Burns the metadata overlay into [image] at the position and style
  /// chosen by the user.
  void _drawOverlay(img.Image image) {
    final lines = _buildOverlayLines();

    const lineH = 30;
    const padH = 14;
    const padV = 10;

    final boxH = lines.length * lineH + padV * 2;
    final maxLen = lines.fold(0, (m, l) => l.length > m ? l.length : m);
    final boxW = (maxLen * 13.5 + padH * 2).round().clamp(180, image.width - 20);

    // Map [0–1] anchor to pixel coordinates and clamp to image bounds.
    var boxX = (image.width * _overlayAnchor.dx).round();
    var boxY = (image.height * _overlayAnchor.dy).round();
    boxX = boxX.clamp(0, image.width - boxW);
    boxY = boxY.clamp(0, image.height - boxH);

    // Background
    if (_overlayBg != OverlayBg.none) {
      for (var py = boxY; py < (boxY + boxH).clamp(0, image.height); py++) {
        for (var px = boxX; px < (boxX + boxW).clamp(0, image.width); px++) {
          final o = image.getPixel(px, py);
          if (_overlayBg == OverlayBg.black) {
            image.setPixel(px, py, img.ColorRgba8(
              (o.r * 0.2).round(), (o.g * 0.2).round(), (o.b * 0.2).round(), 255));
          } else {
            // White — brighten toward white
            image.setPixel(px, py, img.ColorRgba8(
              (o.r * 0.3 + 178).round().clamp(0, 255),
              (o.g * 0.3 + 178).round().clamp(0, 255),
              (o.b * 0.3 + 178).round().clamp(0, 255), 255));
          }
        }
      }
    }

    // Text
    final textColor = _overlayBg == OverlayBg.white
        ? img.ColorRgba8(20, 20, 20, 255)
        : img.ColorRgba8(255, 255, 255, 255);

    for (var i = 0; i < lines.length; i++) {
      final tx = boxX + padH;
      final ty = boxY + padV + i * lineH;
      if (_overlayBg == OverlayBg.none) {
        // Drop shadow for readability with no background
        img.drawString(image, lines[i],
            font: img.arial24,
            x: tx + 2, y: ty + 2,
            color: img.ColorRgba8(0, 0, 0, 200));
      }
      img.drawString(image, lines[i],
          font: img.arial24, x: tx, y: ty, color: textColor);
    }
  }

  List<String> _buildOverlayLines() {
    final d = _data!;
    return [
      'Time:  ${DateFormat('yyyy-MM-dd  HH:mm').format(d.displayedTime)}'
          '${d.timeModified ? '  [MODIFIED]' : ''}',
      'Taken: ${DateFormat('yyyy-MM-dd  HH:mm').format(d.capturedTime)}',
      'Addr:  ${d.userAddress}${d.addressModified ? '  [MODIFIED]' : ''}',
      'GPS:   ${d.lat.toStringAsFixed(5)}, ${d.lng.toStringAsFixed(5)}',
      if (d.jobId.isNotEmpty) 'Job:   ${d.jobId}',
      if (d.crew.isNotEmpty) 'Crew:  ${d.crew}',
    ];
  }

  // ── Date / time picker ───────────────────────────────────

  Future<void> _pickDateTime() async {
    final d = _data!;
    final pickedDate = await showDatePicker(
      context: context,
      initialDate: d.displayedTime,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (pickedDate == null || !mounted) return;
    final pickedTime = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(d.displayedTime),
    );
    if (pickedTime == null) return;
    final combined = DateTime(pickedDate.year, pickedDate.month, pickedDate.day,
        pickedTime.hour, pickedTime.minute);
    setState(() {
      d.displayedTime = combined;
      d.timeModified = combined.difference(d.capturedTime).inMinutes.abs() > 1;
    });
  }

  // ── UI ───────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    if (_errorMessage != null) return _errorScreen();
    if (!_ready || _controller == null) return _loadingScreen();
    return _cameraScreen();
  }

  Widget _loadingScreen() => const Scaffold(
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircularProgressIndicator(),
              SizedBox(height: 16),
              Text('Initialising camera & location…'),
            ],
          ),
        ),
      );

  Widget _errorScreen() => Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.error_outline, color: Colors.red, size: 56),
                const SizedBox(height: 16),
                Text(_errorMessage!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 14)),
                const SizedBox(height: 24),
                ElevatedButton.icon(
                  onPressed: () => setState(() {
                    _errorMessage = null;
                    _ready = false;
                    _init();
                  }),
                  icon: const Icon(Icons.refresh),
                  label: const Text('Retry'),
                ),
              ],
            ),
          ),
        ),
      );

  Widget _cameraScreen() {
    final d = _data!;
    final size = MediaQuery.of(context).size;

    return Scaffold(
      body: Stack(
        fit: StackFit.expand,
        children: [
          // ── Camera preview ──
          CameraPreview(_controller!),

          // ── Draggable overlay position handle ──
          Positioned(
            left: (size.width * _overlayAnchor.dx).clamp(0.0, size.width - 230),
            top: (size.height * _overlayAnchor.dy).clamp(0.0, size.height - 110),
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onPanUpdate: (details) {
                setState(() {
                  _overlayAnchor = Offset(
                    (_overlayAnchor.dx + details.delta.dx / size.width)
                        .clamp(0.0, 0.85),
                    (_overlayAnchor.dy + details.delta.dy / size.height)
                        .clamp(0.0, 0.87),
                  );
                });
              },
              child: _overlayPreviewWidget(),
            ),
          ),

          // ── Top bar: editable fields ──
          SafeArea(
            child: Align(
              alignment: Alignment.topCenter,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(10, 8, 10, 0),
                child: Container(
                  decoration: BoxDecoration(
                    color: Colors.black54,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  padding: const EdgeInsets.all(10),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _field(
                        ctrl: _addressCtrl,
                        hint: 'Address',
                        icon: Icons.location_on_outlined,
                        onChanged: (v) {
                          d.userAddress = v;
                          d.addressModified = v != d.gpsAddress;
                        },
                      ),
                      const SizedBox(height: 6),
                      Row(children: [
                        Expanded(
                          child: _field(
                            ctrl: _jobCtrl,
                            hint: 'Job ID',
                            icon: Icons.work_outline,
                            onChanged: (v) => d.jobId = v,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: _field(
                            ctrl: _crewCtrl,
                            hint: 'Crew',
                            icon: Icons.people_outline,
                            onChanged: (v) => d.crew = v,
                          ),
                        ),
                      ]),
                    ],
                  ),
                ),
              ),
            ),
          ),

          // ── Bottom bar: timestamp + controls ──
          Positioned(
            bottom: 0,
            left: 0,
            right: 0,
            child: SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Modification badges
                    if (d.timeModified || d.addressModified)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Wrap(
                          spacing: 8,
                          children: [
                            if (d.timeModified)
                              _badge('TIME MODIFIED', Colors.orange),
                            if (d.addressModified)
                              _badge('ADDRESS MODIFIED', Colors.orange),
                          ],
                        ),
                      ),

                    // Timestamp selector
                    GestureDetector(
                      onTap: _pickDateTime,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 16, vertical: 10),
                        decoration: BoxDecoration(
                          color: Colors.black54,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                              color: d.timeModified
                                  ? Colors.orange
                                  : Colors.white24),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.access_time,
                                size: 16,
                                color: d.timeModified
                                    ? Colors.orange
                                    : Colors.white70),
                            const SizedBox(width: 8),
                            Text(
                              DateFormat('yyyy-MM-dd   HH:mm')
                                  .format(d.displayedTime),
                              style: TextStyle(
                                color: d.timeModified
                                    ? Colors.orange
                                    : Colors.white,
                                fontSize: 15,
                                letterSpacing: 0.5,
                              ),
                            ),
                            const SizedBox(width: 8),
                            const Icon(Icons.edit,
                                size: 13, color: Colors.white38),
                          ],
                        ),
                      ),
                    ),

                    const SizedBox(height: 12),

                    // Controls row: flash | shutter | bg-style
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        // Flash toggle
                        _iconButton(
                          icon: _flashIcon(_flashMode),
                          color: _flashMode == FlashMode.off
                              ? Colors.white38
                              : Colors.yellow,
                          onTap: _cycleFlash,
                        ),
                        const SizedBox(width: 28),

                        // Shutter
                        GestureDetector(
                          onTap: _saving ? null : _takePhoto,
                          child: Container(
                            width: 74,
                            height: 74,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color:
                                  _saving ? Colors.grey[600] : Colors.white,
                              border:
                                  Border.all(color: Colors.white60, width: 4),
                              boxShadow: const [
                                BoxShadow(
                                    color: Colors.black38,
                                    blurRadius: 8,
                                    spreadRadius: 2)
                              ],
                            ),
                            child: _saving
                                ? const Padding(
                                    padding: EdgeInsets.all(20),
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        color: Colors.black54),
                                  )
                                : const Icon(Icons.camera_alt,
                                    color: Colors.black87, size: 34),
                          ),
                        ),

                        const SizedBox(width: 28),

                        // Overlay background cycle
                        _bgToggleButton(),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ── Overlay preview widget (draggable handle) ────────────

  Widget _overlayPreviewWidget() {
    final textColor =
        _overlayBg == OverlayBg.white ? Colors.black87 : Colors.white;
    final bgColor = _overlayBg == OverlayBg.black
        ? Colors.black54
        : _overlayBg == OverlayBg.white
            ? Colors.white70
            : Colors.transparent;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: Colors.orange.withOpacity(0.7), width: 1.5),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Drag affordance row
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.drag_indicator,
                  size: 11, color: Colors.orange),
              const SizedBox(width: 3),
              Text('DRAG',
                  style: const TextStyle(
                      color: Colors.orange,
                      fontSize: 9,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 0.8)),
            ],
          ),
          const SizedBox(height: 3),
          ..._buildOverlayLines().map((line) => Text(
                line,
                style: TextStyle(
                  color: textColor,
                  fontSize: 10,
                  fontFamily: 'monospace',
                  height: 1.5,
                ),
              )),
        ],
      ),
    );
  }

  // ── EXIF helpers ────────────────────────────────────────

  Map<String, String> _buildExifAttrs() {
    final d = _data!;
    final descParts = <String>[
      d.userAddress,
      if (d.jobId.isNotEmpty) 'Job: ${d.jobId}',
      if (d.crew.isNotEmpty) 'Crew: ${d.crew}',
      if (d.timeModified) '[TIME MODIFIED]',
      if (d.addressModified) '[ADDRESS MODIFIED]',
    ];
    return {
      'GPSLatitude': d.lat.toString(),
      'GPSLongitude': d.lng.toString(),
      'DateTimeOriginal':
          DateFormat('yyyy:MM:dd HH:mm:ss').format(d.displayedTime),
      'DateTimeDigitized':
          DateFormat('yyyy:MM:dd HH:mm:ss').format(d.capturedTime),
      'DateTime': DateFormat('yyyy:MM:dd HH:mm:ss').format(d.displayedTime),
      'ImageDescription': descParts.join(' | '),
    };
  }

  // ── Flash & overlay background helpers ──────────────────

  void _cycleFlash() {
    final next = {
      FlashMode.auto: FlashMode.always,
      FlashMode.always: FlashMode.off,
      FlashMode.off: FlashMode.auto,
    }[_flashMode]!;
    _controller?.setFlashMode(next);
    setState(() => _flashMode = next);
  }

  IconData _flashIcon(FlashMode mode) {
    switch (mode) {
      case FlashMode.always:
        return Icons.flash_on;
      case FlashMode.off:
        return Icons.flash_off;
      case FlashMode.auto:
      default:
        return Icons.flash_auto;
    }
  }

  void _cycleBg() =>
      setState(() => _overlayBg =
          OverlayBg.values[(_overlayBg.index + 1) % OverlayBg.values.length]);

  Widget _bgToggleButton() {
    final (icon, label, color) = switch (_overlayBg) {
      OverlayBg.black => (Icons.rectangle, 'Dark', Colors.white70),
      OverlayBg.white => (Icons.rectangle_outlined, 'Light', Colors.white70),
      OverlayBg.none  => (Icons.hide_image_outlined, 'None', Colors.white38),
    };
    return GestureDetector(
      onTap: _cycleBg,
      child: Container(
        width: 48,
        height: 48,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: Colors.black45,
          border: Border.all(color: Colors.white24),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 18, color: color),
            Text(label,
                style: TextStyle(
                    color: color, fontSize: 8, letterSpacing: 0.3)),
          ],
        ),
      ),
    );
  }

  // ── Small reusable widgets ───────────────────────────────

  Widget _iconButton({
    required IconData icon,
    required Color color,
    required VoidCallback onTap,
  }) =>
      GestureDetector(
        onTap: onTap,
        child: Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: Colors.black45,
            border: Border.all(color: Colors.white24),
          ),
          child: Icon(icon, color: color, size: 24),
        ),
      );

  Widget _field({
    required TextEditingController ctrl,
    required String hint,
    required IconData icon,
    required ValueChanged<String> onChanged,
  }) =>
      TextField(
        controller: ctrl,
        style: const TextStyle(color: Colors.white, fontSize: 13),
        onChanged: onChanged,
        decoration: InputDecoration(
          hintText: hint,
          hintStyle: const TextStyle(color: Colors.white54),
          prefixIcon: Icon(icon, size: 17, color: Colors.white54),
        ),
      );

  Widget _badge(String label, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
          color: color.withOpacity(0.15),
          border: Border.all(color: color, width: 1),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(
          label,
          style: TextStyle(
              color: color,
              fontSize: 11,
              fontWeight: FontWeight.bold,
              letterSpacing: 0.5),
        ),
      );
}
