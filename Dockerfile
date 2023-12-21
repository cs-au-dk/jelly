FROM ubuntu:20.04 as node-builder
WORKDIR /tools

# install Node & update NPM
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    netcat \
    ca-certificates && \
    apt-get autoremove -y && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
ARG NODE_VERSION=20.9.0
ARG NODE_PACKAGE=node-v${NODE_VERSION}-linux
RUN arch="$(dpkg --print-architecture)"; \
        case "$arch" in \
            amd64) export ARCH='x64' ;; \
            arm64) export ARCH='arm64' ;; \
        esac; \
    \
    wget -c https://nodejs.org/dist/v$NODE_VERSION/$NODE_PACKAGE-$ARCH.tar.gz -O -| tar -xzC /tools/ && \
    mv /tools/$NODE_PACKAGE-$ARCH /tools/node && \
    PATH="/tools/node/bin:$PATH" npm install -g "npm@^9.8.0"
    # GraalJS uses Node 16 which is not supported by npm v10

FROM ubuntu:20.04 as nodeprof-builder
WORKDIR /tools

# install GraalVM JavaScript and NodeProf
RUN apt-get update && apt-get install -y git gcc g++ make python3 python3-pip && pip3 install ninja_syntax
RUN git clone --depth=1 --branch 6.42.0 https://github.com/graalvm/mx.git
RUN /tools/mx/mx fetch-jdk --java-distribution labsjdk-ce-17 --to /tools --alias jdk
ENV JAVA_HOME=/tools/jdk
# set up a specific version of nodeprof.js
WORKDIR /tools/nodeprof.js
RUN git init && \
    git remote add origin https://github.com/Haiyang-Sun/nodeprof.js.git && \
    git fetch origin edc3be9ea55b4fa59bb26c74e7f0d29602556c56 && \
    git reset --hard FETCH_HEAD
RUN /tools/mx/mx sforceimports
RUN /tools/mx/mx build
RUN /tools/mx/mx --dy /compiler build

FROM ubuntu:20.04
RUN mkdir -p /usr/lib/jvm
COPY --from=node-builder /tools/node /opt/node
COPY --from=nodeprof-builder /tools/jdk /usr/lib/jvm/jdk
COPY --from=nodeprof-builder /tools/graal/sdk/latest_graalvm_home /usr/lib/jvm/graalvm
ENV NODE_PATH /opt/node/lib/node_modules
ENV PATH /opt/node/bin:$PATH
ENV JAVA_HOME=/usr/lib/jvm/jdk
ENV GRAAL_HOME=/usr/lib/jvm/graalvm
ENV NODE_OPTIONS --max-old-space-size=8192
ENV NODE_ENV production

# install Jelly files built locally
RUN mkdir /jelly
WORKDIR /jelly
COPY ./package.json ./package-lock.json ./
COPY ./resources ./resources
COPY ./bin ./bin
RUN npm ci --omit=dev
COPY ./lib ./lib
RUN npm link
ENTRYPOINT ["node", "/jelly/lib/main.js"]
