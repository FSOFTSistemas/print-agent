docker build -t print-agent .

  docker run -d \
    --name print-agent \
    --restart unless-stopped \
    -p 9100:9100 \
    -v print-agent-data:/data \
    -v /dev/bus/usb:/dev/bus/usb \
    --device-cgroup-rule='c 189:* rmw' \
    print-agent