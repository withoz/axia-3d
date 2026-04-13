// SKP 파일 로드 테스트

import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function testSKPLoading() {
  console.log('========================================');
  console.log('SKP File Loading Test');
  console.log('========================================\n');
  
  try {
    const skpPath = '/sessions/dreamy-hopeful-fermi/test_model.skp';
    const buffer = fs.readFileSync(skpPath);
    console.log(`✓ SKP 파일 읽음: ${path.basename(skpPath)}`);
    console.log(`  파일 크기: ${buffer.length} bytes\n`);
    
    const zip = new JSZip();
    const skpZip = await zip.loadAsync(buffer);
    
    console.log('✓ SKP ZIP 파싱 완료\n');
    
    const files = Object.keys(skpZip.files);
    console.log(`✓ ZIP 내부 파일 (${files.length}개):`);
    for (const fileName of files) {
      const file = skpZip.files[fileName];
      console.log(`  - ${fileName}${file.dir ? ' [폴더]' : ' [파일]'}`);
    }
    console.log('');
    
    console.log('✓ 메타데이터 추출:');
    let metadataContent = null;
    if (skpZip.files['SketchUp/metadata']) {
      try {
        metadataContent = await skpZip.files['SketchUp/metadata'].async('string');
        console.log(`  - SketchUp/metadata 찾음 (${metadataContent.length} bytes)`);
        console.log(`  내용 (처음 200자):\n${metadataContent.substring(0, 200)}\n`);
      } catch (e) {
        console.log(`  - 읽기 실패\n`);
      }
    }
    
    console.log('✓ 형상 데이터 검색:');
    let foundGeometry = false;
    for (const fileName of files) {
      if (fileName.includes('document') || fileName.includes('model')) {
        try {
          const content = await skpZip.files[fileName].async('string');
          if (content.length > 0) {
            foundGeometry = true;
            console.log(`  - ${fileName} 찾음 (${content.length} bytes)`);
          }
        } catch (e) {
          // 무시
        }
      }
    }
    
    console.log('\n========================================');
    console.log('✅ SKP 파일 로드 성공!');
    console.log('========================================\n');
    console.log(`📊 결과:`);
    console.log(`  - 파일: ${path.basename(skpPath)}`);
    console.log(`  - 크기: ${buffer.length} bytes`);
    console.log(`  - ZIP 항목: ${files.length}개`);
    console.log(`  - 메타데이터: ${metadataContent ? '✓ 추출됨' : '✗ 미추출'}`);
    console.log(`  - 형상 데이터: ${foundGeometry ? '✓ 감지됨' : '✗ 플레이스홀더'}\n`);
    
  } catch (error) {
    console.error('❌ 오류:', error.message);
    process.exit(1);
  }
}

testSKPLoading();
