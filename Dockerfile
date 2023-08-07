FROM ubuntu:20.04 as node-builder
WORKDIR /tools

# install Node & update NPM
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    netcat \
    ca-certificates  && \
    apt-get autoremove -y && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
ARG NODE_VERSION=18.17.0
ARG NODE_PACKAGE=node-v${NODE_VERSION}-linux
RUN arch="$(dpkg --print-architecture)"; \
        case "$arch" in \
            amd64) export ARCH='x64' ;; \
            arm64) export ARCH='arm64' ;; \
        esac; \
    \
    wget -c https://nodejs.org/dist/v$NODE_VERSION/$NODE_PACKAGE-$ARCH.tar.gz -O -| tar -xzC /tools/ && \
    mv /tools/$NODE_PACKAGE-$ARCH /tools/node && \
    PATH="/tools/node/bin:$PATH" npm install -g "npm@>=9.8.0"

FROM ubuntu:20.04 as nodeprof-builder
WORKDIR /tools

# install GraalVM JavaScript and NodeProf
RUN apt-get update && apt-get install -y git gcc g++ make python3 python3-pip && pip3 install ninja_syntax
RUN git clone --depth=1 --branch 6.0.4 https://github.com/graalvm/mx.git
RUN /tools/mx/mx fetch-jdk --java-distribution labsjdk-ce-17
RUN mv /root/.mx/jdks/labsjdk-ce-17-* /tools/jdk
ENV JAVA_HOME=/tools/jdk
RUN git clone --depth=1 https://github.com/Haiyang-Sun/nodeprof.js.git
WORKDIR /tools/nodeprof.js
RUN /tools/mx/mx sforceimports
RUN /tools/mx/mx build
RUN /tools/mx/mx --dy /compiler build
ENV GRAAL_HOME=/tools/graal/sdk/latest_graalvm_home

FROM ubuntu:20.04
RUN mkdir -p /usr/lib/jvm
COPY --from=node-builder /tools/node /opt/node
COPY --from=nodeprof-builder /tools/jdk /usr/lib/jvm/jdk
COPY --from=nodeprof-builder /tools/graal/sdk/latest_graalvm_home /usr/lib/jvm/graalvm
ENV NODE_PATH /opt/node/lib/node_modules
ENV PATH /opt/node/bin:$PATH
ENV JAVA_HOME=/usr/lib/jvm/jdk
ENV GRAAL_HOME=/usr/lib/jvm/graalvm
ENV NODE_OPTIONS --max-old-space-size=8000
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
