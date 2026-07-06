pipeline {
    agent none

    environment {
        IMAGE_NAME = '127.0.0.1:5000/crm-tablet'
    }

    stages {
        stage('Docker Build & Push') {
            agent {
                label 'docker'
            }

            steps {
                script {
                    def branch = env.GIT_BRANCH ?: 'unknown'
                    def tag

                    if (branch == 'origin/main') {
                        tag = 'latest'
                    } else if (branch == 'origin/develop') {
                        tag = 'develop'
                    } else {
                        error("Build przerwany: branch '${branch}' nie jest obsługiwany (tylko 'main' lub 'develop').")
                    }

                    def buildDate = sh(
                        script: 'date -u +"%Y-%m-%dT%H:%M:%SZ"',
                        returnStdout: true
                    ).trim()

                    def gitCommit = sh(
                        script: 'git rev-parse --short HEAD',
                        returnStdout: true
                    ).trim()

                    echo "Building ${IMAGE_NAME}:${tag}"
                    echo "Build Date: ${buildDate}"
                    echo "Git Commit: ${gitCommit}"

                    sh """
                      docker build \\
                        --build-arg BUILD_DATE="${buildDate}" \\
                        --build-arg GIT_COMMIT="${gitCommit}" \\
                        -f ./deploy/Dockerfile \\
                        -t ${IMAGE_NAME}:${tag} \\
                        .
                    """

                    sh """
                      docker run --rm ${IMAGE_NAME}:${tag} cat /usr/share/nginx/html/build-info.txt
                    """

                    sh """
                      docker push ${IMAGE_NAME}:${tag}
                    """

                    echo "Image ${IMAGE_NAME}:${tag} built and pushed successfully"
                }
            }
        }
    }

    post {
        success { echo "Deployment tabletu zakończony sukcesem" }
        failure { echo "Build tabletu nie powiódł się" }
    }
}
