# Validacao da reconexao USB

Esta correcao mantem os drivers atuais (Zadig/libusb), endpoints HTTP e buffers
ESC/POS/ZPL. Nao implementa impressao pelo spooler do Windows.

## Instalacao para teste

- Gere o instalador pelo `setup.iss` no Inno Setup. Ele inclui `usb-printer.js`.
- Encerre somente o processo do Print Agent antes de instalar/substituir arquivos.
- Para atualizar manualmente, copie **server.js e usb-printer.js** para a pasta do
  Agent. Nao basta copiar somente server.js.
- Inicie `start-silent.vbs` uma vez. Essa reinicializacao inicial e necessaria para
  carregar a correcao; depois, teste os ciclos da impressora sem reiniciar o Agent.
- Nao e necessario atualizar API, web, PDV ou app. Nao ha novas dependencias.

## Teste fisico (L42 Pro Full e impressora de cupons)

1. Confirme `http://localhost:9100/status` e consulte `/printers`.
2. Imprima uma etiqueta ZPL. Confira dimensoes, texto e leitura do codigo de barras.
3. Desligue a L42, aguarde alguns segundos e ligue novamente na mesma porta USB.
4. Aguarde o Windows reconhecer a impressora, atualize a lista e imprima novamente,
   sem executar Zadig ou reiniciar o Agent. Repita pelo menos cinco vezes.
5. Com a impressora desligada, tente imprimir: deve retornar erro. Religue e faca
   uma nova solicitacao; a falha anterior nao deve bloquear as seguintes.
6. Teste listar impressoras durante uma impressao e enviar dois trabalhos seguidos.
   As operacoes USB devem ser serializadas.
7. Teste tambem cupom ESC/POS, a rota USB legada se utilizada e impressao de rede
   (esta ultima nao foi alterada).

Nao ha reenvio automatico de impressao, inclusive em timeout/desconexao, pois o
trabalho pode ter sido parcialmente impresso. Confira o papel antes de reenviar.
Resposta de sucesso significa transferencia USB concluida, nao confirmacao do papel.

Se persistir a falha, registre o erro exato do Agent e compare o driver atual no
Zadig antes/depois. A correcao nao impede o Windows de substituir um driver.

## Testes automatizados sem impressora

```powershell
node --test tests/usb-printer.test.js
node --check server.js
node --check usb-printer.js
```

Os testes simulam os dispositivos; nao substituem o teste fisico de reconexao.
