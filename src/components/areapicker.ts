import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { map } from "lit/directives/map.js";
import _ from "lodash";
import { globalStyles } from "./styles";

interface Snippet {
  title?: string;
  displayName: string;
  children?: Snippet[];
  assetLocation?: string;
}

const areas: Snippet = {
  title: "Wo schmerzt es?",
  displayName: "",
  children: [
    {
      title: "Welche Ansicht vom ganzen Körper?",
      displayName: "Ganzer Körper",
      children: [
        {
          displayName: "Frontal",
          assetLocation: "wholeFront",
        },
        {
          displayName: "Von Hinten",
          assetLocation: "wholeBack",
        },
        {
          displayName: "Rechte Seite",
          assetLocation: "wholeRight",
        },
        {
          displayName: "Linke Seite",
          assetLocation: "wholeLeft",
        },
      ],
    },
    {
      title: "Welcher Bereich?",
      displayName: "Bereich",
      children: [
        {
          title: "Wo am Kopf und Nacken?",
          displayName: "Kopf und Nacken",
          children: [
            {
              displayName: "Frontal",
              assetLocation: "partsHeadFront",
            },
            {
              displayName: "Hinterkopf und Nacken",
              assetLocation: "partsHeadBack",
            },
            {
              displayName: "Rechte Seite",
              assetLocation: "partsHeadRight",
            },
            {
              displayName: "Linke Seite",
              assetLocation: "partsHeadLeft",
            },
          ],
        },
        {
          title: "Wo an Armen und Händen?",
          displayName: "Arme und Hände",
          children: [
            {
              displayName: "Rechter Arm",
              assetLocation: "partsArmsRight",
            },
            {
              displayName: "Rechte Hand",
              assetLocation: "partsArmsHandRight",
            },
            {
              displayName: "Linker Arm",
              assetLocation: "partsArmsLeft",
            },
            {
              displayName: "Linke Hand",
              assetLocation: "partsArmsHandLeft",
            },
          ],
        },
        {
          title: "Wo am Torso?",
          displayName: "Torso",
          children: [
            {
              displayName: "Frontal",
              assetLocation: "partsUpperFront",
            },
            {
              displayName: "Rücken",
              assetLocation: "partsUpperBack",
            },
            {
              displayName: "Rechte Seite",
              assetLocation: "partsUpperRight",
            },
            {
              displayName: "Linke Seite",
              assetLocation: "partsUpperLeft",
            },
          ],
        },
        {
          title: "Wo am Unterkörper?",
          displayName: "Unterkörper",
          children: [
            {
              displayName: "Frontal",
              assetLocation: "partsLowerFront",
            },
            {
              displayName: "Gesäß",
              assetLocation: "partsLowerBack",
            },
          ],
        },
        {
          title: "Wo an Beinen und Füßen?",
          displayName: "Beine und Füße",
          children: [
            {
              displayName: "Beine Vorne",
              assetLocation: "partsLegsFront",
            },
            {
              displayName: "Beine Hinten",
              assetLocation: "partsLegsBack",
            },
            {
              displayName: "Rechter Fuß",
              assetLocation: "partsLegsFootRight",
            },
            {
              displayName: "Linker Fuß",
              assetLocation: "partsLegsFootLeft",
            },
          ],
        },
      ],
    },
  ],
};

@customElement("area-picker")
export class AreaPicker extends LitElement {
  static styles = [
    globalStyles,
    css`
      .window {
        position: absolute;
        top: 5%;
        left: 30%;
        height: 80vh;
        width: 35vw;
      }

      h1 {
        color: rgb(165, 137, 127);
        margin-bottom: 1.5em;
      }

      .close-button {
        cursor: pointer;
      }

      .areapicker-button {
        position: fixed;
        bottom: 4%;
        left: 45%;
        cursor: pointer;
        border-radius: 50%;
        height: 8em;
        width: 8em;
        background-image: url(/assets/icons/Körperregion.png);
        background-size: contain;
      }
    `,
  ];

  @state()
  selection: string[] = [];

  @state()
  assetLocation: string | undefined;

  @state()
  isWindowOpen = true;

  private _addSelection(name: string) {
    this.selection = [...this.selection, name];
  }

  private _areaPicked(assetLocation: string) {
    this.assetLocation = assetLocation;
    const areaChosen = new Event("area-chosen", { bubbles: true, composed: true });
    this.dispatchEvent(areaChosen);
    this.isWindowOpen = false;
  }

  render() {
    let navigation: Snippet = areas;
    for (const path of this.selection) {
      if (navigation.children) {
        const next = navigation.children.find((item) => item.displayName === path) as Snippet;

        if (!next.children) continue;
        navigation = next;
      }
    }

    return html`
      <div
        class="areapicker-button"
        @click=${() => {
          this.selection = [];
          this.isWindowOpen = true;
        }}
      ></div>
      ${this.isWindowOpen
        ? html`
            <div class="box window">
              <div class="row">
                <p>${navigation.title}</p>
                <div class="close-button" @click=${() => (this.isWindowOpen = false)}>X</div>
              </div>
              <ul>
                ${map(
                  navigation.children,
                  (item) =>
                    html`
                      <h1
                        style="cursor: pointer;"
                        @click=${() =>
                          item.assetLocation
                            ? this._areaPicked(item.assetLocation)
                            : this._addSelection(item.displayName)}
                      >
                        ${item.displayName}
                      </h1>
                    `
                )}
              </ul>
            </div>
          `
        : ""}
    `;
  }
}
