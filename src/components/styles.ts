import { css } from "lit";

export const globalStyles = css`
  html * {
    font-family: Verdana !important;
    font-size: small;
  }

  body {
    background-color: rgb(243, 243, 243);
  }

  #parameters {
    height: 40vh;
    margin: 18px;
  }

  #animation {
    right: 5%;
    top: 30%;
  }

  .box {
    background-color: rgb(249, 249, 249);
    box-shadow: 0.4px 0.4px 5px grey;
    padding: 8px 16px 28px 16px;
    width: 20%;
    display: flex;
    flex-direction: column;
    gap: 1.5em;
  }

  h3 {
    color: #f05959;
    font-size: 1.1em;
  }

  #schmerzbereich {
    position: absolute;
    left: 5%;
    top: 5%;
  }

  #form {
    position: absolute;
    left: 5%;
    top: 42%;
  }

  #materialitaet {
    position: absolute;
    left: 5%;
    top: 70%;
  }

  #farbe {
    position: absolute;
    right: 5%;
    top: 5%;
  }

  #animation {
    position: absolute;
    right: 5%;
    top: 41%;
  }

  #background {
    top: 0;
    left: 0;
    height: 100%;
    width: 100%;
    position: fixed;
    display: grid;
    justify-content: center;
    align-content: center;
  }

  #circle {
    background: white;
    width: 70vw;
    height: 70vw;
    border-radius: 50%;
  }

  #circleContentContainer {
    margin: 15% 15% 15% 15%;
    height: 70%;
    width: 70%;
    display: grid;
    justify-content: center;
    align-content: center;
    align-items: center;
    justify-items: center;
  }

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
    background: #adadad;
    border-radius: 5px;
  }

  input[type="range"]::-webkit-slider-thumb {
    height: 24px;
    width: 24px;
    border-radius: 50%;
    background: #616161;
    cursor: pointer;
    -webkit-appearance: none;
    margin-top: -9.5px;
  }

  input[type="range"]::-moz-range-track {
    height: 6px;
    cursor: pointer;
    background: #adadad;
    border-radius: 5px;
  }

  input[type="range"]::-moz-range-thumb {
    height: 24px;
    width: 24px;
    border-radius: 50%;
    background: #616161;
    cursor: pointer;
    margin-top: -9.5px;
  }

  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 0.5rem;
  }

  label {
    white-space: nowrap;
    margin-right: 8px;
    flex: 1;
  }

  .divider {
    margin: 12px 0;
    width: 100%;
    border-top: 1px solid #bbb;
  }

  /* custom color picker */
  /* HIDE RADIO */
  .custom-picker [type="radio"] {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }

  /* IMAGE STYLES */
  .custom-picker [type="radio"] + div {
    cursor: pointer;
  }

  /* CHECKED STYLES */
  .custom-picker [type="radio"]:checked + div {
    outline: 2px solid #616161;
  }

  .inverted-selection [type="radio"]:checked + div {
    background-color: #cfcfcf;
  }

  .custom-picker label {
    display: grid;
    justify-content: center;
    align-items: center;
  }

  .center {
    display: grid;
    justify-content: center;
    align-items: center;
  }
`;
