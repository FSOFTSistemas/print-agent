# Impressao pela fila do Windows (branch experimental)

Branch no Agent e no web: `feature/impressao-windows-sem-zadig`.

## Escopo e compatibilidade

- Novo transporte opcional `windows`, alem de USB/libusb e rede TCP atuais.
- Seleciona uma impressora instalada no Windows pelo nome exato (`printerName`).
- Usa OpenPrinter/StartDocPrinter/WritePrinter em formato RAW. O mesmo buffer de
  ZPL ou ESC/POS e encaminhado sem conversao, sem arquivo temporario de impressao.
- Precisa de Windows PowerShell 5.1 e spooler ativo. Nao instala pacotes npm novos,
  nao altera politicas permanentes de execucao e nao precisa executar como admin
  se o usuario ja tem permissao para usar a fila instalada.
- A impressora deve compreender os comandos enviados. Uma impressora comum a
  jato de tinta aparecer na lista NAO significa que aceite ZPL/ESC/POS.
- Nao migra nem troca automaticamente impressoras ja selecionadas. O novo modo
  inicialmente e selecionado/testado pelo web. Nao exige mudancas na API.
- USB e rede existentes continuam disponiveis. Nao misturar libusb e driver de
  impressao do fabricante na mesma interface USB durante o teste.

## Como testar sem gerar instalador

1. Preferencialmente use um computador de teste. Anote nome, porta e driver atual
   da L42 antes de qualquer mudanca. Guarde a configuracao anterior para retorno.
2. Encerre o Agent instalado nesse computador para liberar a porta 9100.
3. Instale/associe o driver oficial da Elgin e confirme que a L42 aparece como
   impressora no Windows. Se a interface estiver associada ao WinUSB/libusbK pelo
   Zadig, ela precisa voltar ao driver de impressao do fabricante. Nao excluir
   pacotes de drivers genericamente nem alterar outras impressoras.
4. Confirme a impressao pelo utilitario oficial da Elgin/driver antes do teste.
5. Na branch do Agent, execute `npm start` e mantenha o terminal aberto.
6. Consulte `/printers`: a fila deve aparecer com `type: windows`, `printerName`,
   `driverName`, `portName` e identificador `windows-...`. O endereco e
   `http://localhost:9100/printers` no computador que executa o Agent.
7. Rode o web na mesma branch. Em Configuracoes > Impressora, selecione no slot
   Etiquetas a fila da L42 instalada no Windows (confira driver/porta na lista) e mantenha a linguagem
   **ZPL - Elgin L42 Pro Full (100 x 30 mm)**. Os slots cupons/etiquetas continuam
   independentes e salvos neste navegador.
8. Imprima UMA etiqueta e confira nome, preco, acentos e leitura do barcode.
9. Desligue/ligue a impressora na mesma porta USB ao menos cinco vezes e repita.
   Nao reinicie o Agent nem reinstale driver durante esses ciclos.
10. Teste tambem cupom ESC/POS numa impressora compativel com driver Windows e
    confirme que o modo de rede e o USB direto antigos continuam funcionando.

## Fila e confirmacao

### Perfil opcional da MP-4200 TH

O web agora permite selecionar em Cupons o perfil **Bematech MP-4200 TH -
ESC/POS - 80 mm**. Esse perfil de layout exige tambem a API da branch atualizada;
o transporte Windows sozinho continua sem depender de mudancas na API.
O perfil evita ESC 4/5, seleciona fonte C maior para 42 colunas, PC860 e
espacamento padrao. As 42 colunas aproveitam os 588 dots (73,6 mm) uteis do papel
de 80 mm; nao se deve usar 48 colunas com essa fonte, pois ultrapassam essa area.
Nao muda etiquetas ou a impressora de cozinha. Use com a impressora fisica em
ESC/POS e feche o utilitario Bematech antes de testar. O perfil fica salvo no
navegador junto da impressora de cupons; nao e selecionado automaticamente.

### Confirmacao do spooler

Sucesso significa trabalho aceito pela fila do Windows, NAO papel impresso.
Se a impressora estiver desligada, o Windows pode guardar o trabalho para imprimir
quando ela voltar. Acompanhe a fila antes de reenviar para evitar duplicidade.
Erros/timeouts nao causam reenvio automatico nem fallback para USB/rede.
O retorno inclui `jobId`, que pode ser comparado com a fila do Windows.

Portas FILE:, PORTPROMPT: e NUL: sao recusadas para evitar prompts/arquivos.
Uma falha na listagem USB nao impede listar Windows/rede e vice-versa. Erros de
listagem ficam no terminal do Agent. Politicas corporativas que bloqueiam
PowerShell/Add-Type exigem avaliar a liberacao com o responsavel pelo computador.

## API local

```json
{
  "bufferB64": "...buffer ZPL ou ESC/POS em base64...",
  "printer": {
    "type": "windows",
    "printerName": "Elgin L42 Pro Full"
  }
}
```

Enviar para `POST /print/raw-buffer`. USB legado nao muda. Nomes e buffers sao
enviados ao processo nativo por JSON em stdin, nunca interpolados no PowerShell.

## Distribuicao (somente depois da validacao)

Gerar pelo Inno Setup usando `setup.iss`. Alem dos arquivos anteriores, agora sao
necessarios **windows-printer.js** e **windows-spooler.ps1**, ambos ja incluidos.
Para atualizar manualmente o Agent, copiar os dois novos arquivos e `server.js`,
mantendo tambem `usb-printer.js` da correcao anterior. Reiniciar o Agent uma vez.
Publicar o web da mesma branch para os rotulos adequados. Nao ha migration.

## Testes sem imprimir

```powershell
node --test tests/usb-printer.test.js tests/windows-printer.test.js
```

Esses testes simulam o spooler e os dispositivos. A listagem local e compilacao
do C# foram validadas, mas o teste fisico continua obrigatorio antes de liberar.

## Referencias

- https://learn.microsoft.com/en-us/windows/win32/printdocs/sending-data-directly-to-a-printer
- https://learn.microsoft.com/windows-hardware/drivers/print/raw-data-type

## Retorno ao fluxo anterior

Voltar a branch principal, reinstalar/rodar o Agent anterior e selecionar no web
a impressora antiga. Para voltar ao USB direto na mesma interface, pode ser
necessario reassociar o driver usado com Zadig. Nao remover outras filas/drivers.
