// Ожидаемое поведение: каждые 4 такта на светодиоды выводится следующая ячейка памяти.
// Память из восьми ячеек загружается из rom.hex. Проверочные числа — в expect.json.
module top (
    input  wire       clk,
    output wire [5:0] led
);
    reg [5:0] rom [0:7];
    initial $readmemh("rom.hex", rom);

    reg [1:0] div = 0;
    reg [2:0] addr = 0;
    always @(posedge clk) begin
        div <= div + 1'b1;
        if (div == 2'd3) addr <= addr + 1'b1;
    end
    assign led = rom[addr];
endmodule
