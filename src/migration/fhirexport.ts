// src/migration/export.ts

function exportFhir(model: Model): fhir.IQuestionnaireResponse {
  const template: fhir.IQuestionnaireResponse = {
    resourceType: "QuestionnaireResponse",
    status: fhir.QuestionnaireResponseStatusKind._completed,
    subject: {
      reference: "http://hl7.org/fhir/Patient/1",
      type: "Patient",
    },
    author: {
      reference: "http://hl7.org/fhir/Patient/example",
      type: "Patient",
    },
    item: [
      {
        linkId: "painshapes",
        item: model.painShapes.map((ps) => ({
          linkId: `painshape-${ps.id}`,
          item: [
            {
              linkId: "painshape-x",
              answer: [{ valueDecimal: ps.position.x }],
            },
            {
              linkId: "painshape-y",
              answer: [{ valueDecimal: ps.position.y }],
            },
          ],
        })),
      },
      {
        linkId: "shape",
        item: [
          {
            linkId: "considerConnectedLowerBound",
            answer: [
              {
                valueDecimal: model.considerConnectedLowerBound,
              },
            ],
          },
          {
            linkId: "gravitationForceVisibleLowerBound",
            answer: [
              {
                valueDecimal: model.gravitationForceVisibleLowerBound,
              },
            ],
          },
          {
            linkId: "closeness",
            answer: [
              {
                valueDecimal: model.closeness,
              },
            ],
          },
        ],
      },
      {
        linkId: "coloring",
        item: [
          {
            linkId: "innerColorStart",
            answer: [
              {
                valueDecimal: model.innerColorStart,
              },
            ],
          },
          {
            linkId: "alphaFallOutEnd",
            answer: [
              {
                valueDecimal: model.alphaFallOutEnd,
              },
            ],
          },
          {
            linkId: "outerColorHSL",
            item: [
              {
                linkId: "outerColorHSL-H",
                answer: [{ valueDecimal: model.outerColorHSL[0] }],
              },
              {
                linkId: "outerColorHSL-S",
                answer: [{ valueDecimal: model.outerColorHSL[1] }],
              },
              {
                linkId: "outerColorHSL-L",
                answer: [{ valueDecimal: model.outerColorHSL[2] }],
              },
            ],
          },
          {
            linkId: "innerColorHSL",
            item: [
              {
                linkId: "innerColorHSL-H",
                answer: [{ valueDecimal: model.innerColorHSL[0] }],
              },
              {
                linkId: "innerColorHSL-S",
                answer: [{ valueDecimal: model.innerColorHSL[1] }],
              },
              {
                linkId: "innerColorHSL-L",
                answer: [{ valueDecimal: model.innerColorHSL[2] }],
              },
            ],
          },
        ],
      },
      {
        linkId: "starshape",
        item: [
          {
            linkId: "outerOffsetRatio",
            answer: [
              {
                valueDecimal: model.outerOffsetRatio,
              },
            ],
          },
          {
            linkId: "roundness",
            answer: [
              {
                valueDecimal: model.roundness,
              },
            ],
          },
          {
            linkId: "wings",
            answer: [
              {
                valueInteger: model.wings,
              },
            ],
          },
        ],
      },
      {
        linkId: "animation",
        item: [
          {
            linkId: "dissolve",
            answer: [
              {
                valueDecimal: model.dissolve,
              },
            ],
          },
          {
            linkId: "animationType",
            answer: [
              {
                valueCoding: {
                  code: model.animationType,
                },
              },
            ],
          },
          {
            linkId: "frequencyHz",
            answer: [
              {
                valueDecimal: model.frequencyHz,
              },
            ],
          },
          {
            linkId: "amplitude",
            answer: [
              {
                valueDecimal: model.amplitude,
              },
            ],
          },
          {
            linkId: "origin",
            item: [
              {
                linkId: "origin-x",
                answer: [{ valueDecimal: model.origin[0] }],
              },
              {
                linkId: "origin-y",
                answer: [{ valueDecimal: model.origin[1] }],
              },
            ],
          },
          {
            linkId: "animationParamter",
            answer: [
              {
                valueCoding: {
                  code: model.animationParamter,
                },
              },
            ],
          },
        ],
      },
    ],
  };
  return template;
}
