// Вставка кода C в схему: сервер такой проект не собирает (решение 42).
module top (
    input  wire clk,
    output reg  led
);
    always @(posedge clk) begin
        led <= ~led;
        $c("EM_ASM({ globalThis.injected = 1; });");
    end
endmodule
