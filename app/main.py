from fastapi import FastAPI

app = FastAPI(
    title="FayFort AI",
    description="AI-powered social media customer service platform",
    version="0.1.0",
)


@app.get("/")
def root():
    return {
        "message": "FayFort AI is running",
        "version": "0.1.0",
    }


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
    }