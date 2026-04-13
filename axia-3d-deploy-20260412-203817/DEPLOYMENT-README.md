# AXiA 3D — 자체 서버 배포 가이드

## 패키지 내용

```
├── index.html                         (진입점)
└── assets/
    ├── index-B-SZNBgs.js             (메인 애플리케이션)
    ├── axia_wasm_bg-_kt2sami.wasm    (Rust 엔진)
    └── MaterialLibrary-Dgd2NuIo.js   (라이브러리)
```

## 배포 방법

### 1. Nginx 설정 (권장)

```nginx
server {
    listen 80;
    server_name axia.yourdomain.com;
    
    root /var/www/axia-3d;
    index index.html;
    
    # SPA 라우팅
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    # 정적 자산 캐싱
    location /assets/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
    
    # WASM MIME 타입
    types {
        application/wasm wasm;
    }
    
    # 보안 헤더
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
}
```

### 2. Apache 설정

```apache
<Directory /var/www/axia-3d>
    RewriteEngine On
    RewriteBase /
    RewriteCond %{REQUEST_FILENAME} !-f
    RewriteCond %{REQUEST_FILENAME} !-d
    RewriteRule ^ index.html [QSA,L]
    
    # WASM MIME 타입
    AddType application/wasm .wasm
    
    # 캐싱 정책
    <FilesMatch "\.(wasm|js|css)$">
        Header set Cache-Control "max-age=31536000, immutable"
    </FilesMatch>
</Directory>
```

### 3. 단순 HTTP 서버 (테스트용)

Python 3:
```bash
cd /path/to/axia-3d-deploy
python3 -m http.server 8000
```

Node.js (http-server):
```bash
cd /path/to/axia-3d-deploy
npx http-server -p 8000
```

## 보안 체크리스트

- [x] 소스맵 제거됨 (코드 난독화)
- [x] 모든 JS 최소화됨 (minified)
- [x] 환경 변수 노출 없음
- [x] 민감 파일 없음
- [x] WASM은 바이너리 형태

## HTTPS 설정 (필수)

Let's Encrypt 사용 권장:

```bash
sudo certbot certonly --webroot -w /var/www/axia-3d -d axia.yourdomain.com
```

## WASM MIME 타입 설정

서버에서 `.wasm` 파일의 MIME 타입이 `application/wasm`으로 설정되어야 합니다.

### Nginx
```nginx
types {
    application/wasm wasm;
}
```

### Apache
```apache
AddType application/wasm .wasm
```

## 성능 최적화

1. **Gzip 압축**
```nginx
gzip on;
gzip_types text/plain application/javascript text/css application/wasm;
```

2. **캐시 정책**
- assets/: 30일 캐시 (파일명에 해시 포함)
- index.html: 캐시 안함 (항상 최신 버전 받음)

3. **CDN 활용** (선택)
- CloudFlare 등으로 글로벌 배포

## 문제 해결

**WASM 로딩 실패**
- 서버 로그에서 `.wasm` 파일의 Content-Type 확인
- 브라우저 콘솔에서 네트워크 에러 확인

**화이트 화면 표시**
- 브라우저 콘솔(F12) 에서 JavaScript 에러 확인
- 네트워크 탭에서 `index.html`, `index-B-SZNBgs.js`, WASM 파일 로드 상태 확인

## 지원 기능

- ✓ 곡면 부드러운 렌더링
- ✓ 곡면 그룹 선택
- ✓ 곡면 Push/Pull (방사형 돌출)
- ⚠️ Push/Pull 후 갭 문제 (다음 업데이트에서 수정)

---

**빌드 날짜**: 2026-04-12  
**빌드 ID**: index-B-SZNBgs.js  
**크기**: 2.0 MB (최적화됨)
