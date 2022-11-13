import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { map } from "lit/directives/map.js";
import _ from "lodash";
import { globalStyles } from "./styles";

export type PainShapeRadius = {
  id: number;
  radius: number;
};

@customElement("pain-shapes")
export class PainShapes extends LitElement {
  static styles = [
    globalStyles,
    css`
      /* custom sliders: */
      input[type="range"] {
        -webkit-appearance: none;
        margin: 18px 0;
        flex: 3;
      }

      input[type="range"]:focus {
        outline: none;
      }

      input[type="range"]::-webkit-slider-runnable-track {
        height: 6px;
        cursor: pointer;
        background: #e4e4e4;
        border-radius: 5px;
      }

      input[type="range"]::-webkit-slider-thumb {
        height: 18px;
        width: 18px;
        border-radius: 50%;
        background: white;
        outline: solid 3px #969696;
        cursor: pointer;
        -webkit-appearance: none;
        margin-top: -5px;
      }

      input[type="range"]::-moz-range-track {
        height: 6px;
        cursor: pointer;
        background: #e4e4e4;
        border-radius: 5px;
      }

      input[type="range"]::-moz-range-thumb {
        height: 18px;
        width: 18px;
        border-radius: 50%;
        background: white;
        outline: solid 3px #969696;
        cursor: pointer;
        -webkit-appearance: none;
        margin-top: -5px;
      }

      .trash-button-container {
        flex: 1;
        display: grid;
        justify-items: center;
        align-items: center;
      }

      .trash-button {
        height: 20px;
        width: 20px;
        background-image: url(./assets/icons/Bereich-Trashcan.png);
        background-size: contain;
        background-repeat: no-repeat;
        cursor: pointer;
      }

      ul {
        display: block;
        margin-block-start: 0;
        margin-block-end: 0;
        margin-inline-start: 0;
        margin-inline-end: 0;
        padding-inline-start: 0;
      }

      li {
        list-style-type: none;
      }

      button {
        border: none;
        background-color: unset;
        font-size: 1.5rem;
      }
    `,
  ];

  @state()
  items: PainShapeRadius[] = [
    {
      id: 1,
      radius: 30,
    },
    {
      id: 2,
      radius: 30,
    },
    {
      id: 3,
      radius: 30,
    },
  ];

  render() {
    return html`
      <ul>
        ${map(
          this.items,
          (item) => html`
            <li class="row">
              <label for="${item.id}">Punkt ${item.id}</label>
              <input
                type="range"
                id="${item.id}"
                min="1"
                max="100"
                value="${item.radius}"
                step="1"
                @input=${(e: Event) => {
                  const input = e.target as HTMLInputElement;
                  const currItem = this.items.find((i) => i.id === item.id);
                  if (currItem) currItem.radius = parseFloat(input.value);
                }}
              />
              <div class="trash-button-container">
                <div
                  @click=${() => (this.items = this.items.filter(({ id }) => item.id !== id))}
                  class="trash-button"
                ></div>
              </div>
            </li>
          `
        )}
        <div class="center">
          <button
            @click=${() => {
              const newItem = {
                id: (_.maxBy(this.items, (i) => i.id)?.id ?? 0) + 1,
                radius: 30,
              };
              this.items = [...this.items, newItem];
            }}
          >
            +
          </button>
        </div>
      </ul>
    `;
  }
}
