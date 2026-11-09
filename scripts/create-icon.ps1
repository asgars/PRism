$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assetDirectory = Join-Path $PSScriptRoot '..\assets'
[System.IO.Directory]::CreateDirectory($assetDirectory) | Out-Null
$bitmap = [System.Drawing.Bitmap]::new(256, 256)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$shape = [System.Drawing.Drawing2D.GraphicsPath]::new()
$brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#D1EFAF'))
$pen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#26382D'), 14)
try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $shape.AddArc(8, 8, 64, 64, 180, 90)
    $shape.AddArc(184, 8, 64, 64, 270, 90)
    $shape.AddArc(184, 184, 64, 64, 0, 90)
    $shape.AddArc(8, 184, 64, 64, 90, 90)
    $shape.CloseFigure()
    $graphics.FillPath($brush, $shape)
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $points = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new(128, 57),
        [System.Drawing.PointF]::new(204, 189),
        [System.Drawing.PointF]::new(52, 189)
    )
    $graphics.DrawPolygon($pen, $points)
    $stream = [System.IO.MemoryStream]::new()
    try {
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        $png = $stream.ToArray()
        [System.IO.File]::WriteAllBytes((Join-Path $assetDirectory 'icon.png'), $png)
        $iconStream = [System.IO.File]::Create((Join-Path $assetDirectory 'icon.ico'))
        $writer = [System.IO.BinaryWriter]::new($iconStream)
        try {
            $writer.Write([uint16]0)
            $writer.Write([uint16]1)
            $writer.Write([uint16]1)
            $writer.Write([byte]0)
            $writer.Write([byte]0)
            $writer.Write([byte]0)
            $writer.Write([byte]0)
            $writer.Write([uint16]1)
            $writer.Write([uint16]32)
            $writer.Write([uint32]$png.Length)
            $writer.Write([uint32]22)
            $writer.Write($png)
        }
        finally { $writer.Dispose() }
    }
    finally { $stream.Dispose() }
}
finally {
    $graphics.Dispose()
    $bitmap.Dispose()
    $shape.Dispose()
    $brush.Dispose()
    $pen.Dispose()
}
Get-Item (Join-Path $assetDirectory 'icon.png'), (Join-Path $assetDirectory 'icon.ico') | Select-Object Name, Length