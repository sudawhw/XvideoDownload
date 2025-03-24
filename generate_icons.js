// 此脚本用于生成不同尺寸的图标
// 您可以使用以下命令安装依赖并运行：
// npm install sharp
// node generate_icons.js

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// 需要生成的图标尺寸
const sizes = [16, 48, 128];

// 读取SVG文件
const svgPath = path.join(__dirname, 'images', 'icon.svg');
const svgBuffer = fs.readFileSync(svgPath);

// 为每个尺寸生成PNG图标
async function generateIcons() {
  try {
    for (const size of sizes) {
      const outputPath = path.join(__dirname, 'images', `icon${size}.png`);
      
      await sharp(svgBuffer)
        .resize(size, size)
        .png()
        .toFile(outputPath);
        
      console.log(`成功生成 ${size}x${size} 图标`);
    }
    console.log('所有图标已生成完成！');
  } catch (error) {
    console.error('生成图标时出错:', error);
  }
}

generateIcons(); 