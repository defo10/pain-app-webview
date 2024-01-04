# The Pain App Webview
This repo provides a `PainShapeVisualization` class that can be used to display visual pain shapes on a given asset. It uses pixijs and some custom built shaders. For now, the library is distributed in one `.js` file. Checkout the `dist` folder to get the minified js file. 

To see it in action, checkout the [pain app repo](https://github.com/defo10/pain-app)

# Usage

1. Import the .js file.

```js
const PainVisualization = require("painshapevisualization.js")
```

2. Create an object an pass the a div node in the constructor. PainVis will create a canvas element inside this container.

```js
const painVis = new PainVisualization(document.getElementById("div-container"))
```

3. Start the async setup process by calling start and passing the src to the background asset. Both .png and .jpg files are supported. In theory, all file formats supported by pixijs's `Asset` class should work too.

```js
await painVis.start("assets/background.jpg")
```

4. Update the model parameters by calling `updateModel`. Check out `UserParameters` type in `./src/model.ts` to see the possible parameters.

```js
painVis.updateModel({
  "animation-behavior": "linear-in",
  "color": "blue"
  // and so on... Be sure to set all parameters.
})
```
