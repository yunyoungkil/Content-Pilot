# Firebase Storage CORS 설정 가이드

## 문제
Firebase Storage 이미지를 외부 도메인(예: aistudio.google.com)에서 로드할 때 CORS 오류 발생

## 해결 방법: gsutil 사용

### 1단계: Google Cloud SDK 설치

**Windows:**
1. https://cloud.google.com/sdk/docs/install-sdk#windows 에서 다운로드
2. 설치 프로그램 실행
3. 설치 완료 후 PowerShell 또는 CMD 재시작

**또는 Chocolatey 사용:**
```powershell
choco install gcloudsdk
```

### 2단계: 인증 및 프로젝트 설정

```bash
# Google 계정으로 로그인
gcloud auth login

# 프로젝트 설정
gcloud config set project content-pilot-7eb03
```

### 3단계: CORS 설정 적용

프로젝트 루트 디렉토리에서 실행:

```bash
gsutil cors set cors.json gs://content-pilot-7eb03.firebasestorage.app
```

### 4단계: 설정 확인

```bash
gsutil cors get gs://content-pilot-7eb03.firebasestorage.app
```

## 대안: 코드 레벨 해결 (이미 구현됨)

현재 코드에서 Firebase Storage URL 로드 실패 시 자동으로 Base64로 변환하는 기능이 이미 구현되어 있습니다.

- `thumbnailGenerator.js`: Firebase Storage URL 감지 시 자동 Base64 변환
- `background.js`: `fetch_image_as_base64` 액션으로 이미지 프록시

따라서 CORS 설정 없이도 동작합니다. 다만 CORS 설정을 하면 더 효율적입니다.

## 참고

- Firebase Storage 버킷 이름: `content-pilot-7eb03.firebasestorage.app`
- CORS 설정 파일: `cors.json` (프로젝트 루트에 있음)

