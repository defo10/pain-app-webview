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
      .trash-button-container {
        flex: 1;
        display: grid;
        justify-items: center;
        align-items: center;
      }

      .trash-button {
        height: 20px;
        width: 20px;
        background-image: url(/assets/icons/Bereich-Trashcan.png);
        background-size: contain;
        background-repeat: no-repeat;
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
      radius: 20,
    },
    {
      id: 2,
      radius: 20,
    },
    {
      id: 3,
      radius: 20,
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
                max="70"
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
                radius: 20,
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
