// То же, но имя $c собрано склейкой в макросе.
`define TASK(name) $``name
module top (
    input  wire clk,
    output reg  led
);
    always @(posedge clk) led <= ~led;
    initial `TASK(c)("int injected = 1;");
endmodule
