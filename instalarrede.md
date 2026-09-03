POST http://192.168.15.24:9100/printers/network
{
  "name": "POS",
  "host": "192.168.15.100",
  "port": 9100
}

```bash
curl -X POST 'http://192.168.15.24:9100/printers/network' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "POS",
    "host": "192.168.15.100",
    "port": 9100
  }'
```
