from PIL import Image, ImageDraw
import math

SIZE = 1024
img = Image.new("RGB", (SIZE, SIZE), (20, 30, 45))
px = img.load()

# 对角线渐变 #23a7f5 -> #6f6bff，并叠加左上角柔光
c1 = (35, 167, 245)
c2 = (111, 107, 255)
for y in range(SIZE):
    for x in range(SIZE):
        t = (x + y) / (2.0 * (SIZE - 1))
        r = int(c1[0] + (c2[0] - c1[0]) * t)
        g = int(c1[1] + (c2[1] - c1[1]) * t)
        b = int(c1[2] + (c2[2] - c1[2]) * t)
        d = math.hypot(x - 170, y - 110) / 760
        glow = max(0.0, 1.0 - d) ** 2 * 0.13
        r = int(r + (255 - r) * glow)
        g = int(g + (255 - g) * glow)
        b = int(b + (255 - b) * glow)
        px[x, y] = (r, g, b)

img = img.convert("RGBA")
draw = ImageDraw.Draw(img, "RGBA")

# 内描边
inset = 26
draw.rounded_rectangle(
    (inset, inset, SIZE - inset, SIZE - inset),
    radius=170,
    outline=(255, 255, 255, 34),
    width=3,
)

# RSS 波纹：圆心偏左下，与右侧箭头留出间距
cx, cy = 286, 744
dot_r = 60
draw.ellipse((cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r), fill=(255, 255, 255, 255))
for radius, width, alpha in ((170, 52, 245), (300, 52, 145)):
    box = (cx - radius, cy - radius, cx + radius, cy + radius)
    draw.arc(box, start=-90, end=0, fill=(255, 255, 255, alpha), width=width)

# 右侧下载箭头
ax = 792
draw.line((ax, 188, ax, 510), fill=(255, 255, 255, 245), width=48)
draw.line((ax - 106, 402, ax, 526), fill=(255, 255, 255, 245), width=48)
draw.line((ax + 106, 402, ax, 526), fill=(255, 255, 255, 245), width=48)

out = img.convert("RGB")
out.save("ICON_256.PNG", "PNG", optimize=True)
out.resize((64, 64), Image.LANCZOS).save("ICON.PNG", "PNG", optimize=True)
out.save("app/ui/images/icon_256.png", "PNG", optimize=True)
out.resize((64, 64), Image.LANCZOS).save("app/ui/images/icon_64.png", "PNG", optimize=True)
out.resize((512, 512), Image.LANCZOS).save("docs/icon-512.png", "PNG", optimize=True)
print("icons written")
