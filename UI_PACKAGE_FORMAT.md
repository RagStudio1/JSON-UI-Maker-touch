# Pacote completo de UI

O importador **UI + Assets** abre um arquivo ZIP ou uma pasta e registra todas as texturas antes de criar a interface. Assim, o JSON da UI encontra as imagens pelo mesmo caminho usado no Minecraft JSON UI.

## Estrutura recomendada

```text
minha-ui.zip
├── ui-package.json
├── ui/
│   └── main.json
└── textures/
    └── ui/
        └── minha_ui/
            ├── background.png
            ├── button.png
            └── button.json
```

O ZIP pode conter uma pasta externa, como `minha-ui/ui-package.json`; o importador localiza o manifesto mesmo assim. No Android, ZIP e a opcao mais confiavel. No computador tambem e possivel selecionar a pasta descompactada.

## `ui-package.json`

```json
{
  "$schema": "https://ragstudio1.github.io/JSON-UI-Maker-touch/ui-package.schema.json",
  "format": "json-ui-maker-package",
  "version": 1,
  "name": "Minha UI completa",
  "entry": "ui/main.json",
  "assets": [
    {
      "path": "textures",
      "mount": ""
    }
  ],
  "root": "main_screen",
  "persistAssets": true
}
```

- `format`: sempre `json-ui-maker-package`.
- `version`: atualmente `1`.
- `entry`: JSON principal da UI, relativo ao manifesto. Aceita tanto o formato nativo exportado pelo editor quanto JSON UI universal do Bedrock.
- `assets`: uma ou mais pastas de imagens. Uma string, como `"textures"`, equivale a `{ "path": "textures", "mount": "" }`.
- `mount`: prefixo virtual opcional. Com `path: "textures"` e `mount: ""`, o arquivo `textures/ui/minha_ui/button.png` vira `ui/minha_ui/button` dentro do editor.
- `root`: opcional. Escolhe qual definicao abrir quando o JSON universal possui varias telas. Pode ser `main_screen` ou `namespace.main_screen`.
- `persistAssets`: opcional; o padrao e `true`. Tenta manter as imagens no armazenamento do navegador para o proximo carregamento. Se a cota do navegador acabar, a importacao atual continua funcionando e o editor avisa.

Se o pacote tiver exatamente um JSON de UI, o importador consegue detecta-lo sem manifesto. Para pacotes reais, use o manifesto: ele elimina ambiguidades e permite mover os arquivos sem perder os vinculos.

## Como a UI referencia os assets

Para a estrutura recomendada, o JSON usa o caminho sem extensao:

```json
{
  "namespace": "minha_ui",
  "main_screen": {
    "type": "panel",
    "controls": [
      {
        "background@minha_ui.background": {
          "type": "image",
          "texture": "textures/ui/minha_ui/background",
          "size": [320, 180]
        }
      },
      {
        "confirm_button": {
          "type": "button",
          "$default_texture": "textures/ui/minha_ui/button",
          "$hover_texture": "textures/ui/minha_ui/button",
          "$pressed_texture": "textures/ui/minha_ui/button",
          "$button_text": "Confirmar",
          "size": [120, 32]
        }
      }
    ]
  }
}
```

O importador remove apenas o prefixo `textures/` para formar a chave interna. Portanto estes dois lados precisam corresponder:

```text
JSON:    textures/ui/minha_ui/button
arquivo: textures/ui/minha_ui/button.png
chave:   ui/minha_ui/button
```

## 9-slice

O arquivo 9-slice e opcional, fica ao lado da imagem e deve ter exatamente o mesmo nome:

```text
button.png
button.json
```

Exemplo de `button.json`:

```json
{
  "base_size": [16, 16],
  "nineslice_size": [4, 4, 4, 4]
}
```

Backgrounds e headers que nao usam 9-slice devem ser enviados apenas com a imagem, sem o sidecar `.json`.

## Mais de uma pasta de assets

`mount` permite montar pastas diferentes em caminhos virtuais previsiveis:

```json
{
  "assets": [
    { "path": "shared", "mount": "ui/shared" },
    { "path": "screen-assets", "mount": "ui/minha_ui" }
  ]
}
```

Nesse exemplo, `screen-assets/button.png` e lido como `ui/minha_ui/button`, e a UI deve usar `textures/ui/minha_ui/button`.

O importador rejeita caminhos duplicados, ZIP protegido por senha, ZIP dividido, ZIP64 e caminhos que tentem sair da raiz. O limite atual e de 2.500 arquivos, 96 MB por arquivo e 256 MB descompactados por pacote.
