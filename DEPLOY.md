# Ctrl+Alt+Moe — GitHub Pages 배포 가이드

## 📦 정적 파일 구분

### 🟢 GitHub에 올리는 파일 (소스 코드)

```
Ctrl_Alt_Moe/
├── .github/
│   └── workflows/
│       └── deploy.yml              ← GitHub Pages 자동 배포
├── scripts/
│   └── generate-manifests.js       ← 빌드 시 매니페스트 생성
├── src/                            ← 앱 소스 코드 전체
│   ├── app/
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── CharacterEditor.tsx
│   │   ├── CharacterList.tsx
│   │   ├── ChatPanel.tsx
│   │   ├── SettingsDrawer.tsx
│   │   └── VrmViewer.tsx
│   ├── lib/
│   │   ├── chat/
│   │   ├── db/
│   │   ├── providers/
│   │   ├── utils/
│   │   │   └── asset-path.ts       ← basePath 헬퍼 (NEW)
│   │   └── vrm/
│   └── store/
├── public/                         ← 정적 에셋 (Git LFS 권장)
│   ├── .nojekyll                   ← GitHub Pages Jekyll 비활성화
│   ├── 2D/                         ← 2D 배경 이미지 (21개)
│   ├── hdri/                       ← HDRI 배경 이미지 (10개)
│   ├── motions/                    ← FBX/VRMA 모션 (95개)
│   │   └── motion-tags.json        ← 모션 메타데이터
│   └── vrm/                        ← VRM 모델 (4개)
├── plasmoid/                       ← KDE Plasma 6 위젯 (선택)
├── next.config.ts                  ← 정적 export + basePath 설정
├── package.json                    ← prebuild 스크립트 포함
├── tsconfig.json
└── install-plasmoid.sh             ← KDE 위젯 설치 스크립트
```

### 🔴 GitHub에 올리지 않는 파일

```
.next/                              ← 빌드 캐시 (gitignore)
out/                                ← 빌드 출력물 (gitignore, CI가 생성)
node_modules/                       ← npm 패키지 (gitignore)
public/manifest/                    ← 자동 생성 매니페스트 (gitignore)
.env*                               ← 환경변수 (gitignore)
```

### 🟡 Git LFS 권장 (대용량 바이너리)

```bash
# Git LFS 초기화 (처음 한 번)
git lfs install

# 대용량 에셋 트래킹
git lfs track "*.vrm"
git lfs track "*.fbx"
git lfs track "*.vrma"
git lfs track "*.hdr"
git lfs track "*.exr"
git lfs track "public/2D/*.png"
git lfs track "public/hdri/*.png"
git lfs track "public/hdri/*.jpg"
```

> ⚠️ GitHub LFS 무료 1GB / 유료 $5/50GB. VRM+모션 합계 ~200MB이므로 무료 범위 내.

---

## 🚀 배포 방법

### 1. GitHub Repository 생성

```bash
cd Ctrl_Alt_Moe
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/USERNAME/Ctrl_Alt_Moe.git
git push -u origin main
```

### 2. GitHub Pages 활성화

1. Repository → **Settings** → **Pages**
2. Source: **GitHub Actions** 선택
3. Push하면 자동으로 `.github/workflows/deploy.yml`이 실행됨

### 3. 배포 URL

```
https://USERNAME.github.io/Ctrl_Alt_Moe/
```

---

## 🏗️ 빌드 프로세스

```
npm run build
  │
  ├── 1. prebuild: node scripts/generate-manifests.js
  │      └── public/manifest/files.json 생성
  │          (VRM 4개, HDRI 10개, 2D 21개, 모션 95개 목록)
  │
  ├── 2. next build (output: 'export')
  │      └── out/ 디렉토리에 정적 HTML/JS/CSS + 에셋 출력
  │
  └── 3. GitHub Actions: out/ → GitHub Pages 배포
```

### 로컬 테스트

```bash
# 매니페스트 생성 + 빌드
npm run build

# 정적 파일 서버로 테스트
npx serve out/

# 또는 개발 모드 (매니페스트 자동 생성)
npm run dev
```

---

## 🔧 아키텍처 변경 요약

### Before (Node.js 서버 필요)
```
[Client] → fetch('/api/vrm') → [Next.js API Route] → fs.readdir() → [Response]
[Client] → fetch('/api/backgrounds') → [Next.js API Route] → fs.readdir() → [Response]
```

### After (완전 정적)
```
[빌드 시] scripts/generate-manifests.js → public/manifest/files.json
[Client] → fetch('/manifest/files.json') → [정적 JSON] → 파일 목록 사용
```

| 항목 | Before | After |
|------|--------|-------|
| API 라우트 | `src/app/api/backgrounds/route.ts`, `src/app/api/vrm/route.ts` | ❌ 삭제됨 |
| 파일 스캔 | 런타임 `fs.readdir()` | 빌드 타임 매니페스트 |
| 서버 의존성 | Node.js 서버 필수 | ❌ 불필요 |
| 배포 방식 | `npm run dev` 또는 `npm start` | 정적 HTML (GitHub Pages) |
| 에셋 경로 | 하드코딩 (`/vrm/file.vrm`) | `assetPath()` 헬퍼 (basePath 지원) |

---

## 🖥️ KDE Plasma 6 위젯 연동

### 로컬 개발 (localhost)
```
위젯 설정 → Server URL: http://localhost:3000
```

### GitHub Pages 배포 후
```
위젯 설정 → Server URL: https://USERNAME.github.io/Ctrl_Alt_Moe/
```

### 위젯 설치/업데이트
```bash
./install-plasmoid.sh
```

### 위젯 제거
```bash
kpackagetool6 --type Plasma/Applet --remove org.kde.plasma.ctrlaltmoe
```

---

## 📁 파일 크기 참고

| 카테고리 | 파일 수 | 대략 크기 |
|---------|---------|----------|
| VRM 모델 | 4 | ~50MB |
| FBX 모션 | 90 | ~100MB |
| VRMA 모션 | 5 | ~1MB |
| 2D 배경 | 21 | ~30MB |
| HDRI 배경 | 10 | ~15MB |
| JS/CSS 번들 | - | ~2MB |
| **합계** | **~130+** | **~200MB** |

> GitHub Pages 제한: 1GB (충분)
> GitHub LFS 무료: 1GB 스토리지 + 1GB/월 대역폭
