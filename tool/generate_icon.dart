import 'dart:io';
import 'dart:math' as math;
import 'package:image/image.dart' as img;

void main() {
  const int size = 1024;

  // Create 1024x1024 canvas
  final image = img.Image(width: size, height: size);

  // ---------------------------------------------------------------------------
  // Background: dark slate-blue #1C2A4A
  // ---------------------------------------------------------------------------
  final bgColor = img.ColorRgb8(0x1C, 0x2A, 0x4A);
  img.fill(image, color: bgColor);

  // ---------------------------------------------------------------------------
  // White color helper
  // ---------------------------------------------------------------------------
  final white = img.ColorRgb8(255, 255, 255);
  final lightGrey = img.ColorRgb8(200, 200, 200);
  final darkSlate = img.ColorRgb8(0x1C, 0x2A, 0x4A);

  // ---------------------------------------------------------------------------
  // Camera body: white rounded rectangle x:162–862, y:290–770, radius:70
  // ---------------------------------------------------------------------------
  img.fillRect(
    image,
    x1: 162,
    y1: 290,
    x2: 862,
    y2: 770,
    color: white,
    radius: 70,
  );

  // ---------------------------------------------------------------------------
  // Viewfinder bump: white rounded rect x:390–634, y:210–310, radius:28
  // ---------------------------------------------------------------------------
  img.fillRect(
    image,
    x1: 390,
    y1: 210,
    x2: 634,
    y2: 310,
    color: white,
    radius: 28,
  );

  // ---------------------------------------------------------------------------
  // Lens: light-grey outer ring at (512,530) r=178, then white inner r=160
  // ---------------------------------------------------------------------------
  img.fillCircle(image, x: 512, y: 530, radius: 178, color: lightGrey);
  img.fillCircle(image, x: 512, y: 530, radius: 160, color: white);

  // ---------------------------------------------------------------------------
  // Clock face inside lens
  // ---------------------------------------------------------------------------
  const int cx = 512;
  const int cy = 530;

  // Tick marks — 12 evenly spaced every 30°
  for (int i = 0; i < 12; i++) {
    final double angleDeg = i * 30.0;
    final double angleRad = (angleDeg - 90) * math.pi / 180.0;

    final bool isMajor = (i % 3 == 0); // 0, 3, 6, 9 → major
    final int outerR = 150;
    final int innerR = isMajor ? 132 : 140;
    final int thickness = isMajor ? 4 : 2;

    final int x1 = (cx + outerR * math.cos(angleRad)).round();
    final int y1 = (cy + outerR * math.sin(angleRad)).round();
    final int x2 = (cx + innerR * math.cos(angleRad)).round();
    final int y2 = (cy + innerR * math.sin(angleRad)).round();

    img.drawLine(
      image,
      x1: x1,
      y1: y1,
      x2: x2,
      y2: y2,
      color: darkSlate,
      thickness: thickness,
      antialias: true,
    );
  }

  // Hour hand: 10 o'clock = 300° from 12, length=88, thickness=10
  _drawHand(image, cx, cy, 300.0, 88, 10, darkSlate);

  // Minute hand: 2 o'clock = 60° from 12, length=128, thickness=7
  _drawHand(image, cx, cy, 60.0, 128, 7, darkSlate);

  // Center dot: filled circle r=12, color #1C2A4A
  img.fillCircle(image, x: cx, y: cy, radius: 12, color: darkSlate);

  // ---------------------------------------------------------------------------
  // Save to assets/launcher_icon.png (relative to project root, one level up)
  // ---------------------------------------------------------------------------
  final assetsDir = Directory('../assets');
  if (!assetsDir.existsSync()) {
    assetsDir.createSync(recursive: true);
  }

  final outFile = File('../assets/launcher_icon.png');
  outFile.writeAsBytesSync(img.encodePng(image));

  print('✓ Icon saved to assets/launcher_icon.png');
}

/// Draws a clock hand from the center outward.
///
/// [angleDeg] is measured clockwise from 12 o'clock (0° = 12, 90° = 3, etc.).
void _drawHand(
  img.Image image,
  int cx,
  int cy,
  double angleDeg,
  int length,
  int thickness,
  img.Color color,
) {
  // Convert to standard math angle: 0° = right, counter-clockwise positive.
  // Clock convention: 0° = top (12), clockwise → subtract 90° then keep as-is.
  final double angleRad = (angleDeg - 90.0) * math.pi / 180.0;

  final int x2 = (cx + length * math.cos(angleRad)).round();
  final int y2 = (cy + length * math.sin(angleRad)).round();

  img.drawLine(
    image,
    x1: cx,
    y1: cy,
    x2: x2,
    y2: y2,
    color: color,
    thickness: thickness,
    antialias: true,
  );
}
